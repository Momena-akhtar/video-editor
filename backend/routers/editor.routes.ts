import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { audioExtract } from "../services/audioExtract.service";
import { transcribeAudio } from "../services/transcribeAudio.service";
import { generateASS } from "../services/generateAss.service";
import { burnSubtitles } from "../services/burnSubtitles.service";

const editorRoutes = Router();

// In-memory progress tracker per requestId
type ProgressState = { percent: number; message: string; done: boolean; error?: string };
const progressMap: Map<string, ProgressState> = new Map();

function updateProgress(requestId: string | undefined, update: Partial<ProgressState>) {
  if (!requestId) return;
  const current = progressMap.get(requestId) || { percent: 0, message: "", done: false };
  const next = { ...current, ...update } as ProgressState;
  progressMap.set(requestId, next);
}

const uploadsDir = path.join(process.cwd(), "uploads");
const outputDir = path.join(process.cwd(), "outputs");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["video/mp4", "video/mpeg", "video/quicktime"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files (MP4, MPEG, MOV) are allowed!"));
    }
  },
});

editorRoutes.post("/process-video", upload.single("video"), async (req: Request, res: Response) => {
  try {
    const requestId = (req.body?.requestId as string) || undefined;
    updateProgress(requestId, { percent: 5, message: "Upload received", done: false });
    if (!req.file) {
      updateProgress(requestId, { percent: 100, message: "No file uploaded", done: true, error: "No file" });
      return res.status(400).json({ 
        error: "No file uploaded or invalid file type.",
        success: false 
      });
    }

    const videoPath = req.file.path;
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = Date.now();
    
    updateProgress(requestId, { percent: 15, message: "Extracting audio", done: false });
    const audioResult = await audioExtract(videoPath, {
      outputFormat: 'mp3',
      quality: 'medium'
    });
    
    if (!audioResult.success) {
      updateProgress(requestId, { percent: 100, message: "Audio extraction failed", done: true, error: String(audioResult.error || 'audio error') });
      return res.status(500).json({
        error: `Audio extraction failed: ${audioResult.error}`,
        success: false
      });
    }
    updateProgress(requestId, { percent: 40, message: "Transcribing audio", done: false });
    const transcriptionSegments = await transcribeAudio(audioResult.outputPath!);
    
    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      updateProgress(requestId, { percent: 100, message: "Transcription failed", done: true, error: "Transcription failed or empty" });
      return res.status(500).json({
        error: "Transcription failed or returned no segments",
        success: false
      });
    }

    const assPath = path.join(outputDir, `${videoName}-subtitles-${timestamp}.ass`);
    updateProgress(requestId, { percent: 60, message: "Generating subtitles", done: false });
    generateASS(transcriptionSegments, assPath);

    const outputVideoPath = path.join(outputDir, `${videoName}-with-subtitles-${timestamp}.mp4`);
    updateProgress(requestId, { percent: 75, message: "Burning subtitles into video", done: false });
    await burnSubtitles(videoPath, assPath, outputVideoPath);

    try {
      if (audioResult.outputPath && fs.existsSync(audioResult.outputPath)) {
        fs.unlinkSync(audioResult.outputPath);
      }
      if (fs.existsSync(assPath)) {
        fs.unlinkSync(assPath);
      }
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    } catch (cleanupError) {
      console.warn("Warning: Could not clean up some temporary files:", cleanupError);
    }

    const outputFileName = path.basename(outputVideoPath);
    
    updateProgress(requestId, { percent: 100, message: "Completed", done: true });
    res.json({
      success: true,
      message: "Video processed successfully with subtitles",
      outputFile: outputFileName,
      downloadUrl: `/download/${outputFileName}`,
      transcription: transcriptionSegments,
      videoPath: outputVideoPath
    });

  } catch (error) {
    console.error("Video processing error:", error);
    const requestId = (req.body?.requestId as string) || undefined;
    updateProgress(requestId, { percent: 100, message: "Internal server error", done: true, error: "server_error" });
    res.status(500).json({ 
      error: "Internal server error during video processing",
      success: false 
    });
  }
});

// Route to download processed videos
editorRoutes.get("/download/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
  const filePath = path.join(outputDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: "File not found",
      success: false
    });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', fs.statSync(filePath).size);
  
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
  
  fileStream.on('error', (err) => {
    console.error("Download error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Download failed",
        success: false
      });
    }
  });
});

editorRoutes.post("/upload", upload.single("video"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No file uploaded or invalid file type.",
        success: false 
      });
    }
    
    const audioResult = await audioExtract(req.file.path, {
      outputFormat: 'mp3',
      quality: 'medium'
    });
    
    if (!audioResult.success) {
      return res.status(500).json({
        error: `Audio extraction failed: ${audioResult.error}`,
        success: false
      });
    }

    const transcriptionSegments = await transcribeAudio(audioResult.outputPath!);

    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      return res.status(500).json({
        error: "Transcription failed",
        success: false
      });
    }

    try {
      if (audioResult.outputPath && fs.existsSync(audioResult.outputPath)) {
        fs.unlinkSync(audioResult.outputPath);
      }
    } catch (cleanupError) {
      console.warn("Warning: Could not clean up audio file:", cleanupError);
    }

    res.json({
      success: true,
      transcription: transcriptionSegments,
      text: transcriptionSegments.map(segment => segment.text).join(' ')
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ 
      error: "Internal server error during upload",
      success: false 
    });
  }
});

editorRoutes.use((error: any, req: Request, res: Response, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      const requestId = (req.body?.requestId as string) || undefined;
      updateProgress(requestId, { percent: 100, message: "File too large", done: true, error: "LIMIT_FILE_SIZE" });
      return res.status(400).json({
        error: "File too large. Maximum size is 100MB.",
        success: false
      });
    }
  }
  
  if (error.message.includes("Only video files")) {
    return res.status(400).json({
      error: error.message,
      success: false
    });
  }
  
  console.error("Multer error:", error);
  const requestId = (req.body?.requestId as string) || undefined;
  updateProgress(requestId, { percent: 100, message: "File upload failed", done: true, error: "multer_error" });
  res.status(500).json({
    error: "File upload failed",
    success: false
  });
});

// Progress endpoint
editorRoutes.get('/progress/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const state = progressMap.get(id) || { percent: 0, message: 'Pending', done: false };
  res.json(state);
});

export default editorRoutes;    