import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { audioExtract } from "../services/audioExtract.service";
import { transcribeAudio } from "../services/transcribeAudio.service";
import { generateASS } from "../services/generateAss.service";
import { burnSubtitles } from "../services/burnSubtitles.service";

const editorRoutes = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
const outputDir = path.join(process.cwd(), "outputs");

// Create directories if they don't exist
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

// New route for complete video processing with subtitles
editorRoutes.post("/process-video", upload.single("video"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No file uploaded or invalid file type.",
        success: false 
      });
    }

    const videoPath = req.file.path;
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = Date.now();
    
    console.log("Starting video processing pipeline...");

    // Step 1: Extract audio from video
    console.log("Step 1: Extracting audio...");
    const audioResult = await audioExtract(videoPath, {
      outputFormat: 'mp3',
      quality: 'medium'
    });
    
    if (!audioResult.success) {
      return res.status(500).json({
        error: `Audio extraction failed: ${audioResult.error}`,
        success: false
      });
    }

    // Step 2: Transcribe audio with timing
    console.log("Step 2: Transcribing audio...");
    const transcriptionSegments = await transcribeAudio(audioResult.outputPath!);
    
    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      return res.status(500).json({
        error: "Transcription failed or returned no segments",
        success: false
      });
    }

    // Step 3: Generate ASS subtitle file
    console.log("Step 3: Generating ASS subtitles...");
    const assPath = path.join(outputDir, `${videoName}-subtitles-${timestamp}.ass`);
    await generateASS(transcriptionSegments, assPath, true); // Enable custom font

    // Step 4: Burn subtitles into video
    console.log("Step 4: Burning subtitles into video...");
    const outputVideoPath = path.join(outputDir, `${videoName}-with-subtitles-${timestamp}.mp4`);
    await burnSubtitles(videoPath, assPath, outputVideoPath);

    // Step 5: Clean up temporary files
    console.log("Step 5: Cleaning up temporary files...");
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

    // Step 6: Return the processed video
    console.log("Step 6: Returning processed video...");
    const outputFileName = path.basename(outputVideoPath);
    
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

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error("Download error:", err);
      res.status(500).json({
        error: "Download failed",
        success: false
      });
    }
  });
});

// Keep the original upload route for backward compatibility
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

    // Clean up audio file
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