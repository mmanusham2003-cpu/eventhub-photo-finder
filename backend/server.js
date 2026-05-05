require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const canvas = require('canvas');
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
const { Canvas, Image, ImageData, createCanvas } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

/* ---------- Lazy model loading (faster cold start) ---------- */
let modelsLoaded = false;
let modelsLoading = false;

async function ensureModels() {
  if (modelsLoaded) return;
  if (modelsLoading) {
    while (!modelsLoaded) await new Promise(r => setTimeout(r, 100));
    return;
  }
  modelsLoading = true;
  console.time('model-load');
  await faceapi.tf.ready();
  const modelPath = path.join(__dirname, 'node_modules', '@vladmandic', 'face-api', 'model');
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath),
    faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath),
    faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath),
  ]);
  modelsLoaded = true;
  modelsLoading = false;
  console.timeEnd('model-load');
  console.log('Face-api models loaded');
}

// Start loading in background but don't block server startup
ensureModels().catch(err => console.error('Background model load failed:', err));

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ---------- Health check (instant response, wakes server) ---------- */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', models: modelsLoaded, uptime: process.uptime() });
});

/* ---------- Resize helper for faster face detection ---------- */
function resizeImage(img, maxDim = 600) {
  const { width, height } = img;
  if (width <= maxDim && height <= maxDim) return img;
  const scale = maxDim / Math.max(width, height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

// Set up storage for user selfies
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './selfies';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Endpoint: Find matching photos
app.post('/api/find-photos', upload.single('image'), async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    await ensureModels();

    const selfiePath = req.file.path;
    console.log(`Processing selfie: ${selfiePath}`);
    const rawSelfie = await canvas.loadImage(selfiePath);
    const selfieImg = resizeImage(rawSelfie, 600);
    console.log(`Selfie resized & loaded`);
    
    const selfieDetection = await faceapi.detectSingleFace(selfieImg).withFaceLandmarks().withFaceDescriptor();
    console.log(`Selfie face detection:`, !!selfieDetection);

    if (!selfieDetection) {
      return res.status(400).json({ success: false, error: 'No face detected in the captured selfie. Please try again in better lighting.' });
    }

    const uploadsDir = './uploads';
    const files = fs.readdirSync(uploadsDir);
    const matchedPhotos = [];

    // Process all gallery images in parallel for speed
    const results = await Promise.allSettled(
      files
        .filter(f => f !== req.file.filename && /\.(jpg|jpeg|png)$/i.test(f))
        .map(async (file) => {
          const photoPath = path.join(uploadsDir, file);
          const rawImg = await canvas.loadImage(photoPath);
          const img = resizeImage(rawImg, 600);
          const detections = await faceapi.detectAllFaces(img).withFaceLandmarks().withFaceDescriptors();
          
          for (const detection of detections) {
            const distance = faceapi.euclideanDistance(selfieDetection.descriptor, detection.descriptor);
            if (distance < 0.45) {
              return file; // matched
            }
          }
          return null; // not matched
        })
    );

    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        matchedPhotos.push(`${baseUrl}/uploads/${r.value}`);
      }
    }

    res.json({ success: true, photos: matchedPhotos, message: "Photos matched successfully!" });

  } catch (error) {
    console.error('Error finding photos:', error);
    res.status(500).json({ success: false, error: 'Failed to process image' });
  }
});

// Endpoint: Send emails with selected photos (uses Resend HTTP API — works on Render)
app.post('/api/send-photos', async (req, res) => {
  try {
    const { email, selectedPhotos } = req.body;

    if (!email || !selectedPhotos || selectedPhotos.length === 0) {
      return res.status(400).json({ success: false, error: 'Email and selected photos are required' });
    }

    console.log(`Sending ${selectedPhotos.length} photos to ${email}`);

    // Build attachments array with base64 content
    const attachments = [];
    const imageTags = [];

    for (let i = 0; i < selectedPhotos.length; i++) {
      const photoUrl = selectedPhotos[i];
      const filename = photoUrl.split('/').pop();
      const filePath = path.join(__dirname, 'uploads', filename);
      
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        continue;
      }

      const fileContent = fs.readFileSync(filePath);
      const base64Content = fileContent.toString('base64');
      const ext = path.extname(filename).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      attachments.push({
        filename: filename,
        content: base64Content,
        type: mimeType
      });
      
      imageTags.push(`<img src="cid:photo_${i}" style="max-width: 300px; border-radius: 8px; margin: 5px;" />`);
    }

    if (attachments.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid photos found to send' });
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #6c5ce7;">📸 Here are your event photos!</h2>
        <p>Thanks for attending the event. Here are the ${attachments.length} photo(s) you selected:</p>
        <div style="display: flex; flex-wrap: wrap; gap: 10px;">
          ${attachments.map((a, i) => `<img src="cid:photo_${i}" style="max-width: 300px; border-radius: 8px; margin: 5px;" />`).join('')}
        </div>
        <hr style="margin-top: 20px; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">Sent by EventHub — AI-Powered Event Photography</p>
      </div>
    `;

    // Use Resend HTTP API (no SMTP port needed — works on all cloud platforms)
    const resendApiKey = process.env.RESEND_API_KEY;
    
    if (!resendApiKey) {
      // Fallback: try Nodemailer for local dev
      console.log('No RESEND_API_KEY, falling back to Nodemailer SMTP...');
      let transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false }
      });

      const nmAttachments = attachments.map((a, i) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        cid: `photo_${i}`
      }));

      const info = await transporter.sendMail({
        from: `"EventHub" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "📸 Your Event Photos from EventHub",
        html: htmlContent,
        attachments: nmAttachments
      });
      console.log("Email sent via Nodemailer! MessageId:", info.messageId);
      return res.json({ success: true, message: 'Email sent successfully!' });
    }

    // Resend API call (HTTP — bypasses SMTP port blocking)
    const resendAttachments = attachments.map((a, i) => ({
      filename: a.filename,
      content: a.content,
    }));

    const resendPayload = {
      from: 'EventHub <onboarding@resend.dev>',
      to: [email],
      subject: '📸 Your Event Photos from EventHub',
      html: htmlContent.replace(/cid:photo_\d+/g, (match) => {
        // Replace CID references with inline data for Resend
        const idx = parseInt(match.replace('cid:photo_', ''));
        if (attachments[idx]) {
          return `data:${attachments[idx].type};base64,${attachments[idx].content}`;
        }
        return match;
      }),
      attachments: resendAttachments,
    };

    console.log('Sending via Resend HTTP API...');
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendRes.json();
    
    if (!resendRes.ok) {
      console.error('Resend API error:', resendData);
      return res.status(500).json({ success: false, error: `Email API error: ${resendData.message || JSON.stringify(resendData)}` });
    }

    console.log('Email sent via Resend! ID:', resendData.id);
    res.json({ success: true, message: 'Email sent successfully!' });

  } catch (error) {
    console.error('Error sending email:', error.message);
    res.status(500).json({ success: false, error: `Failed to send email: ${error.message}` });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);

  /* ---------- Keep-alive self-ping (prevents Render free-tier sleep) ---------- */
  const BASE = process.env.BASE_URL;
  if (BASE) {
    const INTERVAL = 14 * 60 * 1000; // 14 minutes
    setInterval(() => {
      fetch(`${BASE}/api/health`).catch(() => {});
    }, INTERVAL);
    console.log(`Keep-alive ping enabled → every 14 min → ${BASE}/api/health`);
  }
});
