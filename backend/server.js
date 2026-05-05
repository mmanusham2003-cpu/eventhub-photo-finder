require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const canvas = require('canvas');
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Load models
async function loadModels() {
  await faceapi.tf.ready();
  const modelPath = path.join(__dirname, 'node_modules', '@vladmandic', 'face-api', 'model');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
  console.log("Face-api models loaded");
}
loadModels();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Set up storage for user selfies
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './selfies'; // Save selfies in a separate folder
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

    const selfiePath = req.file.path;
    console.log(`Processing selfie: ${selfiePath}`);
    const selfieImg = await canvas.loadImage(selfiePath);
    console.log(`Selfie loaded to canvas`);
    
    console.log(`Detecting face in selfie...`);
    const selfieDetection = await faceapi.detectSingleFace(selfieImg).withFaceLandmarks().withFaceDescriptor();
    console.log(`Face detection complete`, !!selfieDetection);

    if (!selfieDetection) {
      return res.status(400).json({ success: false, error: 'No face detected in the captured selfie. Please try again in better lighting.' });
    }

    const uploadsDir = './uploads';
    const files = fs.readdirSync(uploadsDir);
    const matchedPhotos = [];

    for (const file of files) {
      if (file === req.file.filename) continue; // Skip the selfie itself
      
      if (file.match(/\.(jpg|jpeg|png)$/i)) {
        try {
          const photoPath = path.join(uploadsDir, file);
          const img = await canvas.loadImage(photoPath);
          const detections = await faceapi.detectAllFaces(img).withFaceLandmarks().withFaceDescriptors();
          
          let isMatch = false;
          for (const detection of detections) {
            const distance = faceapi.euclideanDistance(selfieDetection.descriptor, detection.descriptor);
            if (distance < 0.45) { // Even stricter distance threshold for high sensitivity
              isMatch = true;
              break;
            }
          }
          
          if (isMatch) {
            const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
            matchedPhotos.push(`${baseUrl}/uploads/${file}`);
          }
        } catch (err) {
          console.error(`Error processing file ${file}:`, err);
        }
      }
    }

    res.json({ success: true, photos: matchedPhotos, message: "Photos matched successfully!" });

  } catch (error) {
    console.error('Error finding photos:', error);
    res.status(500).json({ success: false, error: 'Failed to process image' });
  }
});

// Endpoint: Send emails with selected photos
app.post('/api/send-photos', async (req, res) => {
  try {
    const { email, selectedPhotos } = req.body;

    if (!email || !selectedPhotos || selectedPhotos.length === 0) {
      return res.status(400).json({ success: false, error: 'Email and selected photos are required' });
    }

    // Configure Nodemailer
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const attachments = [];
    const imageTags = [];

    for (let i = 0; i < selectedPhotos.length; i++) {
      const photoUrl = selectedPhotos[i];
      // photoUrl is like http://localhost:5000/uploads/1000083029.jpg
      const filename = photoUrl.split('/').pop();
      const filePath = path.join(__dirname, 'uploads', filename);
      
      const cid = `photo_${i}@eventhub.com`;
      attachments.push({
        filename: filename,
        path: filePath,
        cid: cid
      });
      
      imageTags.push(`<img src="cid:${cid}" style="max-width: 300px; border-radius: 8px; margin: 5px;" />`);
    }

    const htmlContent = `
      <h2>Here are your event photos!</h2>
      <p>Thanks for attending the event. Here are the photos you selected:</p>
      <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        ${imageTags.join('')}
      </div>
    `;

    const info = await transporter.sendMail({
      from: '"EventHub" <noreply@eventhub.com>',
      to: email,
      subject: "Your Event Photos",
      html: htmlContent,
      attachments: attachments
    });

    console.log("Message sent: %s", info.messageId);
    
    // Provide a preview URL if using Ethereal
    const previewUrl = nodemailer.getTestMessageUrl(info);

    res.json({ 
      success: true, 
      message: 'Email sent successfully!', 
      previewUrl: previewUrl || null 
    });

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ success: false, error: 'Failed to send email' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
