import { Router } from 'express';
import { Video } from '../src/models/video';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const router = Router();
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Create video metadata (MVP: associate with sessionId if provided)
router.post('/', async (req, res) => {
  try {
    const { title, filePath, callbackUrl } = req.body;
    if (!title || !filePath) {
      return res.status(400).json({ message: 'title and filePath are required' });
    }

    const video = await Video.create({ title, filePath, callbackUrl });

    res.status(201).json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create video' });
  }
});

// List videos (scoped by session if header provided)
router.get('/', async (req, res) => {
  try {
    const videos = await Video.find({}).sort({ createdAt: -1 }).limit(100);
    res.json(videos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

// Get a single video
router.get('/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Not found' });
    res.json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch video' });
  }
});

// Update a video
router.put('/:id', async (req, res) => {
  try {
    const update = req.body;
    const video = await Video.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!video) return res.status(404).json({ message: 'Not found' });
    res.json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update video' });
  }
});

// Delete a video
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Video.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

// Upload endpoint (multipart/form-data)
router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    const title = (req.body.title as string) || (req.file?.originalname as string) || 'Untitled';
    const callbackUrl = req.body.callbackUrl as string | undefined;
    if (!req.file) {
      return res.status(400).json({ message: 'video file is required' });
    }

    const storedPath = `/uploads/${path.basename(req.file.path)}`;
    const video = await Video.create({ title, filePath: storedPath, callbackUrl, status: 'uploaded' });
    res.status(201).json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to upload video' });
  }
});

// Update status and optionally notify callback
router.post('/:id/status', async (req, res) => {
  try {
    const { status, outputUrl } = req.body as { status?: string; outputUrl?: string };
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { ...(status ? { status } : {}), ...(outputUrl ? { outputUrl } : {}) },
      { new: true }
    );
    if (!video) return res.status(404).json({ message: 'Not found' });

    if (video.callbackUrl) {
      try {
        await axios.post(video.callbackUrl, {
          id: video.id,
          status: video.status,
          outputUrl: video.outputUrl,
          title: video.title,
          filePath: video.filePath,
          updatedAt: video.updatedAt,
        }, { timeout: 5000 });
      } catch (e) {
        console.error('Callback failed', e);
      }
    }

    res.json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update status' });
  }
});

export default router;


