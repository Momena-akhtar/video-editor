import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";

const assetsRoutes = Router();

// Serve manifest files
assetsRoutes.get("/background-audio/manifest", (req: Request, res: Response) => {
  try {
    const manifestPath = path.join(process.cwd(), "assets", "background-audio", "manifest.json");
    
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        error: "Background audio manifest not found",
        success: false
      });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    res.json(manifest);
  } catch (error) {
    console.error("Error reading background audio manifest:", error);
    res.status(500).json({
      error: "Failed to read background audio manifest",
      success: false
    });
  }
});

assetsRoutes.get("/transitions/manifest", (req: Request, res: Response) => {
  try {
    const manifestPath = path.join(process.cwd(), "assets", "transitions", "manifest.json");
    
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        error: "Transitions manifest not found",
        success: false
      });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    res.json(manifest);
  } catch (error) {
    console.error("Error reading transitions manifest:", error);
    res.status(500).json({
      error: "Failed to read transitions manifest",
      success: false
    });
  }
});

// Serve individual audio files
assetsRoutes.get("/background-audio/:filename", (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), "assets", "background-audio", filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Audio file not found",
        success: false
      });
    }

    // Set appropriate content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    let contentType = "audio/mpeg"; // default
    
    if (ext === ".wav") {
      contentType = "audio/wav";
    } else if (ext === ".mp3") {
      contentType = "audio/mpeg";
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error("Audio file streaming error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to stream audio file",
          success: false
        });
      }
    });
  } catch (error) {
    console.error("Error serving audio file:", error);
    res.status(500).json({
      error: "Failed to serve audio file",
      success: false
    });
  }
});

// Serve individual transition video files
assetsRoutes.get("/transitions/:filename", (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), "assets", "transitions", filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Transition file not found",
        success: false
      });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error("Transition file streaming error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to stream transition file",
          success: false
        });
      }
    });
  } catch (error) {
    console.error("Error serving transition file:", error);
    res.status(500).json({
      error: "Failed to serve transition file",
      success: false
    });
  }
});

export default assetsRoutes;
