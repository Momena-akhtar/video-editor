import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { audioExtract } from "../services/audioExtract.service";
import { transcribeAudio } from "../services/transcribeAudio.service";

const editorRoutes = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

    const transcriptionResult = await transcribeAudio(audioResult.outputPath!);

    if (!transcriptionResult) {
      return res.status(500).json({
        error: `Transcription failed: ${transcriptionResult}`,
        success: false
      });
    }

    res.json({
      text: transcriptionResult || "No transcription available"
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
  res.status(500).json({
    error: "File upload failed",
    success: false
  });
});

export default editorRoutes;    