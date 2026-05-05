# EventHub — Find Your Photo + Email Automation System

> AI-powered event photo finder using face recognition. Upload a selfie (or use the webcam), and the system identifies your photos from an event gallery, then delivers them straight to your inbox.

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![React](https://img.shields.io/badge/React-19-blue?logo=react)
![Vite](https://img.shields.io/badge/Vite-8-purple?logo=vite)

---

## ✨ Features

| Feature | Description |
|---|---|
| **Face Recognition** | Uses `@vladmandic/face-api` (SSD-MobileNet + face landmarks + face descriptors) to match your selfie against event photos |
| **Webcam Capture** | Live selfie via browser webcam with one-click capture |
| **File Upload** | Upload an existing selfie from your device |
| **Sample Input** | Select from pre-loaded sample images for quick demo |
| **Email Delivery** | Selected photos are emailed as inline attachments via Nodemailer (Gmail SMTP) |
| **Progress Stepper** | Visual 3-step flow: Upload → Select → Done |
| **Loading States** | Animated overlay with context-aware messages during processing |
| **Error Handling** | Friendly error banners for missing inputs, no face detected, server errors |
| **Responsive Design** | Fully responsive — works on desktop, tablet, and mobile |
| **Lazy Loading** | Images use `loading="lazy"` to avoid loading all data at once |

---

## 🏗 Architecture

```
task 1/
├── backend/               # Express.js API server
│   ├── server.js           # Main server — face matching + email endpoints
│   ├── uploads/            # Event photo gallery (pre-loaded images)
│   ├── selfies/            # Temporary user selfie storage
│   ├── .env                # Environment variables (not committed)
│   └── package.json
├── frontend/              # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx         # Main application component
│   │   ├── index.css       # Full design system (glassmorphism, animations)
│   │   └── main.jsx        # React entry point
│   ├── index.html          # HTML with SEO meta tags
│   └── package.json
└── README.md              # This file
```

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/find-photos` | Upload selfie + email → returns matched photo URLs |
| `POST` | `/api/send-photos` | Email + selected photo URLs → sends email with attachments |
| `GET`  | `/uploads/:file`   | Static file serving for event photos |

---

## 🚀 Setup Instructions

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **Gmail** account with an [App Password](https://support.google.com/accounts/answer/185833) for SMTP

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd "task 1"
```

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory:

```env
PORT=5000
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-gmail-app-password
```

> **Note:** Use a Gmail App Password, not your regular password. Enable 2FA on your Google account, then generate an App Password at https://myaccount.google.com/apppasswords.

Add event photos to the `backend/uploads/` folder (`.jpg`, `.jpeg`, `.png`).

Start the backend:

```bash
npm start
```

The server runs on `http://localhost:5000`.

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The app opens at `http://localhost:5173`.

---

## 🎮 Usage Walkthrough

1. **Enter your email** in the input field
2. **Provide a selfie** — choose one of three methods:
   - 📷 **Webcam**: Click "Take a Live Selfie" → Capture
   - 📁 **Upload**: Click "Upload a Photo" → select from device
   - 🖼️ **Sample**: Click any sample thumbnail for a quick demo
3. Click **"Find My Photos"** — the backend scans all event photos for face matches
4. **Select photos** you want (use "Select All" for convenience)
5. Click **"Send Photos"** — selected images are emailed to your address
6. ✅ **Success** — check your inbox!

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Axios, react-webcam, Lucide icons |
| Backend | Node.js, Express 5, Multer, Nodemailer |
| AI/ML | @vladmandic/face-api (TensorFlow.js WASM backend) |
| Styling | Vanilla CSS with glassmorphism, CSS animations |
| Email | Gmail SMTP via Nodemailer |

---

## ⚡ Performance Optimizations

- **Lazy image loading**: All gallery images use `loading="lazy"` to defer off-screen images
- **Server-side face detection**: Heavy ML processing happens on the backend (Node.js + WASM), keeping the browser lightweight
- **Multer disk storage**: Selfies are streamed to disk, not held in memory
- **Selective scanning**: Only `.jpg/.jpeg/.png` files are processed; non-image files are skipped
- **Strict distance threshold** (`< 0.45`): Reduces false positives, speeding up user selection

---

## 📝 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Backend port (default: 5000) |
| `EMAIL_USER` | Yes | Gmail address for sending emails |
| `EMAIL_PASS` | Yes | Gmail App Password |

---

## 📄 License

MIT
