import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';
import {
  Camera, Mail, Upload, RefreshCw, Send,
  CheckCircle, Image as ImageIcon, Search, ArrowLeft
} from 'lucide-react';
import './index.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Sample selfie thumbnails served from backend uploads (first 6 images)
const SAMPLE_IMAGES = [
  `${API_URL}/uploads/1000083029.jpg`,
  `${API_URL}/uploads/1000083178.jpg`,
  `${API_URL}/uploads/1000079860.jpg`,
  `${API_URL}/uploads/1000090135.jpg`,
  `${API_URL}/uploads/1000096181.jpg`,
  `${API_URL}/uploads/1000101629.jpg`,
];

/* ---------- helpers ---------- */
function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new File([u8], filename, { type: mime });
}

async function urlToFile(url, filename) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

/* ---------- Stepper ---------- */
function Stepper({ current }) {
  const steps = ['Upload', 'Select', 'Done'];
  return (
    <div className="stepper">
      {steps.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && <div className={`step-line${i <= current - 1 ? ' done' : ''}`} />}
          <div className="step-item">
            <div className={`step-circle${i + 1 === current ? ' active' : ''}${i + 1 < current ? ' done' : ''}`}>
              {i + 1 < current ? '✓' : i + 1}
            </div>
            <span className={`step-label${i + 1 === current ? ' active' : ''}`}>{label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------- Main App ---------- */
export default function App() {
  const [email, setEmail] = useState('');
  const [imageSrc, setImageSrc] = useState(null);
  const [isWebcamOpen, setIsWebcamOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [photos, setPhotos] = useState([]);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);
  const [sampleSelected, setSampleSelected] = useState(null);
  const [serverReady, setServerReady] = useState(false);

  const webcamRef = useRef(null);

  const videoConstraints = { width: 1280, height: 720, facingMode: 'user' };

  /* Pre-warm backend on page load — server wakes while user fills email */
  useEffect(() => {
    let cancelled = false;
    const warmUp = async () => {
      try {
        const res = await fetch(`${API_URL}/api/health`);
        const data = await res.json();
        if (!cancelled) setServerReady(data.status === 'ok');
      } catch {
        // retry after 3s if server is cold-starting
        setTimeout(async () => {
          try {
            await fetch(`${API_URL}/api/health`);
            if (!cancelled) setServerReady(true);
          } catch { /* still waking */ }
        }, 3000);
      }
    };
    warmUp();
    return () => { cancelled = true; };
  }, []);

  /* webcam capture */
  const capture = useCallback(() => {
    const src = webcamRef.current?.getScreenshot();
    if (src) {
      setImageSrc(src);
      setIsWebcamOpen(false);
      setSampleSelected(null);
    }
  }, []);

  const retakePhoto = () => {
    setImageSrc(null);
    setIsWebcamOpen(false);
    setSampleSelected(null);
  };

  /* file upload */
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageSrc(reader.result);
        setIsWebcamOpen(false);
        setSampleSelected(null);
      };
      reader.readAsDataURL(file);
    }
  };

  /* sample selection */
  const handleSampleSelect = (url) => {
    setSampleSelected(url);
    setImageSrc(url);
    setIsWebcamOpen(false);
  };

  /* find photos */
  const handleFindPhotos = async () => {
    if (!email) { setError('Please enter your email address.'); return; }
    if (!imageSrc) { setError('Please provide a selfie or select a sample.'); return; }

    setError(null);
    setLoading(true);
    setLoadingMsg('Analyzing your face…');

    try {
      let file;
      if (imageSrc.startsWith('data:')) {
        file = dataURLtoFile(imageSrc, 'selfie.jpg');
      } else {
        setLoadingMsg('Preparing sample image…');
        file = await urlToFile(imageSrc, 'selfie.jpg');
      }

      setLoadingMsg('Scanning event photos for matches…');

      const formData = new FormData();
      formData.append('email', email);
      formData.append('image', file);

      const response = await axios.post(`${API_URL}/api/find-photos`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data.success) {
        setPhotos(response.data.photos);
        setStep(2);
      } else {
        setError(response.data.error || 'Failed to find photos.');
      }
    } catch (err) {
      const msg = err.response?.data?.error;
      setError(msg || 'Error connecting to server. Make sure the backend is running.');
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  /* photo selection */
  const togglePhoto = (url) => {
    setSelectedPhotos((prev) =>
      prev.includes(url) ? prev.filter((p) => p !== url) : [...prev, url]
    );
  };

  const selectAll = () => {
    setSelectedPhotos(selectedPhotos.length === photos.length ? [] : [...photos]);
  };

  /* send email */
  const handleSendEmail = async () => {
    if (selectedPhotos.length === 0) { setError('Select at least one photo.'); return; }

    setLoading(true);
    setError(null);
    setLoadingMsg('Sending photos to your inbox…');

    try {
      const response = await axios.post(`${API_URL}/api/send-photos`, {
        email,
        selectedPhotos,
      });

      if (response.data.success) {
        setStep(3);
      } else {
        setError(response.data.error || 'Failed to send email.');
      }
    } catch (err) {
      setError('Error connecting to server.');
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  /* reset */
  const startOver = () => {
    setStep(1);
    setImageSrc(null);
    setSelectedPhotos([]);
    setEmail('');
    setPhotos([]);
    setError(null);
    setSampleSelected(null);
  };

  /* -------- RENDER -------- */
  return (
    <div id="root-inner">
      <h1 className="title">EventHub</h1>
      <p className="subtitle">AI-powered photo finder — find yourself in every moment</p>

      <Stepper current={step} />

      <div className="glass-panel">
        {error && <div className="error-banner">{error}</div>}

        {/* ===== STEP 1: Input ===== */}
        {step === 1 && !loading && (
          <div>
            {/* Email */}
            <div className="mb-3 text-left">
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                Your Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={17} style={{ position: 'absolute', left: 12, top: 14, color: 'var(--text-muted)' }} />
                <input
                  id="email-input"
                  type="email"
                  className="input-field"
                  style={{ paddingLeft: '2.5rem' }}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Selfie section */}
            <div className="mb-3 text-left">
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                Your Selfie
              </label>

              {!imageSrc && !isWebcamOpen && (
                <div className="flex flex-col gap-1">
                  <div className="upload-option" onClick={() => setIsWebcamOpen(true)}>
                    <div className="icon-wrap blue"><Camera size={24} /></div>
                    <p className="opt-title">Take a Live Selfie</p>
                    <p className="opt-desc">Use your webcam to snap a photo</p>
                  </div>

                  <div className="divider"><span>or</span></div>

                  <label className="upload-option" style={{ display: 'block' }}>
                    <div className="icon-wrap green"><Upload size={24} /></div>
                    <p className="opt-title">Upload a Photo</p>
                    <p className="opt-desc">Choose an image from your device</p>
                    <input id="file-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                  </label>

                  <div className="divider"><span>or pick a sample</span></div>

                  <div className="sample-grid">
                    {SAMPLE_IMAGES.map((url, i) => (
                      <div
                        key={i}
                        className={`sample-thumb${sampleSelected === url ? ' selected' : ''}`}
                        onClick={() => handleSampleSelect(url)}
                      >
                        <img src={url} alt={`Sample ${i + 1}`} loading="lazy" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isWebcamOpen && (
                <div className="webcam-container">
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    videoConstraints={videoConstraints}
                    style={{ width: '100%', display: 'block' }}
                  />
                  <button
                    id="capture-btn"
                    onClick={capture}
                    className="btn btn-primary"
                    style={{ position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', borderRadius: 30 }}
                  >
                    <Camera size={18} /> Capture
                  </button>
                </div>
              )}

              {imageSrc && (
                <div>
                  <img src={imageSrc} alt="Your selfie" className="captured-image" />
                  <div className="flex gap-1 justify-center">
                    <button id="retake-btn" onClick={retakePhoto} className="btn btn-secondary">
                      <RefreshCw size={16} /> Retake
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              id="find-btn"
              className="btn btn-primary w-full"
              onClick={handleFindPhotos}
              disabled={!email || !imageSrc}
              style={{ marginTop: '0.5rem' }}
            >
              <Search size={18} /> Find My Photos
            </button>
          </div>
        )}

        {/* ===== Loading State ===== */}
        {loading && (
          <div className="loading-overlay">
            <div className="pulse-ring">
              <div className="loader" />
            </div>
            <p>{loadingMsg || 'Processing…'}</p>
          </div>
        )}

        {/* ===== STEP 2: Results ===== */}
        {step === 2 && !loading && (
          <div>
            {photos.length > 0 ? (
              <>
                <h2 style={{ fontSize: '1.4rem', margin: '0 0 0.25rem', fontWeight: 700 }}>
                  <ImageIcon size={22} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  {photos.length} Photo{photos.length > 1 ? 's' : ''} Found
                </h2>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
                  Tap to select the photos you'd like emailed to <strong style={{ color: '#fff' }}>{email}</strong>
                </p>

                <button
                  id="select-all-btn"
                  className="btn btn-secondary"
                  onClick={selectAll}
                  style={{ fontSize: '0.82rem', padding: '0.45rem 1rem', marginBottom: '0.5rem' }}
                >
                  {selectedPhotos.length === photos.length ? 'Deselect All' : 'Select All'}
                </button>

                <div className="photo-grid">
                  {photos.map((photo, i) => (
                    <div
                      key={i}
                      className={`photo-card${selectedPhotos.includes(photo) ? ' selected' : ''}`}
                      onClick={() => togglePhoto(photo)}
                    >
                      <img src={photo} alt={`Match ${i + 1}`} loading="lazy" />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="no-results">
                <span className="emoji">😔</span>
                <h2 style={{ fontSize: '1.4rem', margin: '0 0 0.5rem' }}>No Matches Found</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
                  We couldn't find your face in the event photos. Try a different selfie with better lighting.
                </p>
              </div>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
              <button id="back-btn" className="btn btn-secondary" onClick={() => setStep(1)} style={{ flex: 1 }}>
                <ArrowLeft size={16} /> Back
              </button>
              {photos.length > 0 && (
                <button
                  id="send-btn"
                  className="btn btn-primary"
                  onClick={handleSendEmail}
                  disabled={selectedPhotos.length === 0}
                  style={{ flex: 2 }}
                >
                  <Send size={16} /> Send {selectedPhotos.length} Photo{selectedPhotos.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ===== STEP 3: Success ===== */}
        {step === 3 && !loading && (
          <div className="success-wrap">
            <div className="success-icon-wrap">
              <CheckCircle size={40} style={{ color: 'var(--accent)' }} />
            </div>
            <h2 style={{ fontSize: '1.6rem', margin: '0 0 0.5rem', fontWeight: 700 }}>Photos Sent!</h2>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 2rem', fontSize: '0.95rem' }}>
              {selectedPhotos.length} photo{selectedPhotos.length !== 1 ? 's' : ''} delivered to{' '}
              <strong style={{ color: '#fff' }}>{email}</strong>
            </p>
            <button id="start-over-btn" className="btn btn-primary" onClick={startOver}>
              Start Over
            </button>
          </div>
        )}
      </div>

      <footer className="footer">
        © {new Date().getFullYear()} EventHub · AI-Powered Event Photography
      </footer>
    </div>
  );
}
