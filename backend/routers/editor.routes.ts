import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { audioExtract } from "../services/audioExtract.service";
import { transcribeAudio } from "../services/transcribeAudio.service";
import { generateASS } from "../services/generateAss.service";
import { burnSubtitles } from "../services/burnSubtitles.service";
import { silenceTrim } from "../services/silenceTrim.service";
import { fillerWordTrim } from "../services/fillerWordTrim.service";
import { ZoomEffectService } from "../services/zoomEffect.service";
import { applyMultiZoom } from "../services/multiZoom.service";
import { VideoTransitionService } from "../services/videoTransition.service";
import { AudioOverlayService } from "../services/audioOverlay.service";

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
    
    // Step 1: Trim silence from video
    updateProgress(requestId, { percent: 10, message: "Trimming silence", done: false });
    const trimResult = await silenceTrim(videoPath, {
      silenceThreshold: -35, // -35dB
      minSilenceLength: 0.25, // 0.25 seconds
      paddingAroundSpeech: 0.12 // 120ms padding
    });
    
    if (!trimResult.success) {
      updateProgress(requestId, { percent: 100, message: "Silence trimming failed", done: true, error: String(trimResult.error || 'trim error') });
      return res.status(500).json({
        error: `Silence trimming failed: ${trimResult.error}`,
        success: false
      });
    }
    
    // Use trimmed video path for further processing
    let processedVideoPath = trimResult.outputPath || videoPath;
    
    // Step 2: Trim filler words from the silence-trimmed video
    updateProgress(requestId, { percent: 12, message: "Detecting and removing filler words", done: false });
    const fillerTrimResult = await fillerWordTrim(processedVideoPath, {
      sensitivity: 0.7, // Balanced sensitivity
      minFillerDuration: 0.1, // 100ms minimum
      maxFillerDuration: 2.0, // 2 second maximum
      paddingBefore: 0.05, // 50ms padding before
      paddingAfter: 0.05 // 50ms padding after
    });
    
    if (fillerTrimResult.success && fillerTrimResult.outputPath) {
      // Update to use filler-trimmed video for further processing
      processedVideoPath = fillerTrimResult.outputPath;
    } else {
      console.warn("Filler word trimming failed, continuing with silence-trimmed video:", fillerTrimResult.error);
    }
    
    updateProgress(requestId, { percent: 18, message: "Extracting audio", done: false });
    const audioResult = await audioExtract(processedVideoPath, {
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
    updateProgress(requestId, { percent: 45, message: "Transcribing audio", done: false });
    const transcriptionSegments = await transcribeAudio(audioResult.outputPath!);
    
    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      updateProgress(requestId, { percent: 100, message: "Transcription failed", done: true, error: "Transcription failed or empty" });
      return res.status(500).json({
        error: "Transcription failed or returned no segments",
        success: false
      });
    }

    // Step 3: Apply zoom effect (start slightly zoomed in, return to normal)
    updateProgress(requestId, { percent: 60, message: "Applying zoom effect", done: false });
    const zoomService = new ZoomEffectService();
    const zoomedOutputPath = path.join(outputDir, `${videoName}-simple-zoom-${timestamp}.mp4`);
    let zoomResult: { success: boolean; outputPath?: string; error?: string } = { success: false };
    try {
      await zoomService.applyZoomEffect(processedVideoPath, zoomedOutputPath, {
        startZoom: 1.2,
        endZoom: 1.0,
        durationSec: 2.0,
        easing: "ease-out",
      });
      zoomResult = { success: true, outputPath: zoomedOutputPath };
    } catch (e: any) {
      zoomResult = { success: false, error: e?.message || String(e) };
    }
    
    if (zoomResult.success && zoomResult.outputPath) {
      processedVideoPath = zoomResult.outputPath;
    } else {
      console.warn("Zoom effect failed, continuing without zoom:", zoomResult.error);
    }

    // Step 3.5: Optionally apply user-selected transitions
    // Expect req.body.transitions as JSON array of { id: string, time: number, duration?: number }
    try {
      const rawTransitions = req.body?.transitions as string | undefined;
      const transitions: Array<{ id: string; time: number; duration?: number }> = rawTransitions ? JSON.parse(rawTransitions) : [];
      if (Array.isArray(transitions) && transitions.length > 0) {
        updateProgress(requestId, { percent: 62, message: "Applying transitions", done: false });
        const videoTransitionService = new VideoTransitionService();
        // Apply in chronological order; chain outputs
        const sorted = [...transitions].sort((a, b) => a.time - b.time);
        for (let i = 0; i < sorted.length; i++) {
          const t = sorted[i];
          const stepOut = path.join(outputDir, `${videoName}-transition-${i + 1}-${timestamp}.mp4`);
          await videoTransitionService.addTransition(
            processedVideoPath,
            stepOut,
            t.id,
            { transitionTime: Number(t.time) || 0, duration: t.duration ?? 1.0 }
          );
          // cleanup previous file if it was an intermediate file and exists
          try {
            if (processedVideoPath !== videoPath && fs.existsSync(processedVideoPath)) {
              fs.unlinkSync(processedVideoPath);
            }
          } catch (_) {}
          processedVideoPath = stepOut;
          updateProgress(requestId, { percent: 62 + Math.min(10, Math.floor(((i + 1) / sorted.length) * 10)), message: `Applied transition ${i + 1}/${sorted.length}`, done: false });
        }
      }
    } catch (e) {
      console.warn("Transition application skipped or failed:", e);
    }

    // Step 3.6: Optionally apply background audio overlays
    // Expect req.body.audios as JSON array of { id: string, startTime?: number, endTime?: number, volume?: number, fadeIn?: number, fadeOut?: number, loop?: boolean }
    try {
      const rawAudios = req.body?.audios as string | undefined;
      const audios: Array<{ id: string; startTime?: number; endTime?: number; volume?: number; fadeIn?: number; fadeOut?: number; loop?: boolean }> = rawAudios ? JSON.parse(rawAudios) : [];
      if (Array.isArray(audios) && audios.length > 0) {
        updateProgress(requestId, { percent: 68, message: "Overlaying background audio", done: false });
        const audioOverlayService = new AudioOverlayService();
        // Apply sequentially to accumulate mixes
        for (let i = 0; i < audios.length; i++) {
          const a = audios[i];
          const stepOut = path.join(outputDir, `${videoName}-audio-${i + 1}-${timestamp}.mp4`);
          await audioOverlayService.addBackgroundAudio(
            processedVideoPath,
            stepOut,
            a.id,
            {
              startTime: a.startTime,
              endTime: a.endTime,
              volume: a.volume,
              fadeIn: a.fadeIn,
              fadeOut: a.fadeOut,
              loop: a.loop,
            }
          );
          try {
            if (processedVideoPath !== videoPath && fs.existsSync(processedVideoPath)) {
              fs.unlinkSync(processedVideoPath);
            }
          } catch (_) {}
          processedVideoPath = stepOut;
          updateProgress(requestId, { percent: 68 + Math.min(8, Math.floor(((i + 1) / audios.length) * 8)), message: `Added audio ${i + 1}/${audios.length}`, done: false });
        }
      }
    } catch (e) {
      console.warn("Audio overlay skipped or failed:", e);
    }

    // Step 4: Apply multi-zoom effect at sentence boundaries
    // updateProgress(requestId, { percent: 65, message: "Applying multi-zoom effect", done: false });
    // const multiZoomedOutputPath = path.join(outputDir, `${videoName}-multi-zoom-${timestamp}.mp4`);
    // const multiZoomResult = await applyMultiZoom(processedVideoPath, multiZoomedOutputPath, transcriptionSegments, {
    //   sentencesPerZoom: 2,
    //   bufferSec: 0.2,
    //   startZoom: 1.0,
    //   endZoom: 1.15,
    //   durationSec: 1.0,
    //   easing: "ease-in-out",
    // });
    
    // if (multiZoomResult.success && multiZoomResult.outputPath) {
    //   processedVideoPath = multiZoomResult.outputPath;
    // } else {
    //   console.warn("Multi-zoom effect failed, continuing without multi-zoom:", multiZoomResult.error);
    // }

    const assPath = path.join(outputDir, `${videoName}-subtitles-${timestamp}.ass`);
    updateProgress(requestId, { percent: 75, message: "Generating subtitles", done: false });
    generateASS(transcriptionSegments, assPath);

    const outputVideoPath = path.join(outputDir, `${videoName}-with-subtitles-${timestamp}.mp4`);
    updateProgress(requestId, { percent: 85, message: "Burning subtitles into video", done: false });
    await burnSubtitles(processedVideoPath, assPath, outputVideoPath);

    try {
      if (audioResult.outputPath && fs.existsSync(audioResult.outputPath)) {
        fs.unlinkSync(audioResult.outputPath);
      }
      if (fs.existsSync(assPath)) {
        fs.unlinkSync(assPath);
      }
      // Clean up original uploaded file
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      // Clean up intermediate video files
      if (trimResult.outputPath && trimResult.outputPath !== videoPath && fs.existsSync(trimResult.outputPath)) {
        fs.unlinkSync(trimResult.outputPath);
      }
      if (fillerTrimResult.success && fillerTrimResult.outputPath && 
          fillerTrimResult.outputPath !== trimResult.outputPath && 
          fs.existsSync(fillerTrimResult.outputPath)) {
        fs.unlinkSync(fillerTrimResult.outputPath);
      }
      // Clean up zoom effect intermediate file
      if (zoomResult.success && zoomResult.outputPath && 
          zoomResult.outputPath !== fillerTrimResult.outputPath && 
          fs.existsSync(zoomResult.outputPath)) {
        fs.unlinkSync(zoomResult.outputPath);
      }
      // Clean up any last processed intermediate if different from final
      if (processedVideoPath !== outputVideoPath && processedVideoPath !== videoPath && fs.existsSync(processedVideoPath)) {
        try { fs.unlinkSync(processedVideoPath); } catch (_) {}
      }
      // // Clean up multi-zoom effect intermediate file
      // if (multiZoomResult.success && multiZoomResult.outputPath && 
      //     multiZoomResult.outputPath !== zoomResult.outputPath && 
      //     fs.existsSync(multiZoomResult.outputPath)) {
      //   fs.unlinkSync(multiZoomResult.outputPath);
      // }
    } catch (cleanupError) {
      console.warn("Warning: Could not clean up some temporary files:", cleanupError);
    }

    const outputFileName = path.basename(outputVideoPath);
    
    updateProgress(requestId, { percent: 100, message: "Completed", done: true });
    console.log("completed successsfull")
    res.json({
      success: true,
      message: "Video processed successfully with subtitles",
      outputFile: outputFileName,
      downloadUrl: `/download/${outputFileName}`,
      transcription: transcriptionSegments,
      videoPath: outputVideoPath,
      silenceTrimmed: trimResult.silenceSegments && trimResult.silenceSegments.length > 0,
      silenceSegments: trimResult.silenceSegments || [],
      fillerWordsTrimmed: Boolean(fillerTrimResult.success),
      fillerSegments: [],
      processingStats: {
        originalDuration: trimResult.originalDuration || 0,
        silenceRemoved: (trimResult.originalDuration || 0) - (trimResult.trimmedDuration || 0),
        fillerWordsRemoved: 0,
        totalTimeReduction: ((trimResult.originalDuration || 0) - (trimResult.trimmedDuration || 0))
      }
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

// Apply only transitions to an uploaded video
editorRoutes.post("/apply-transitions", upload.single("video"), async (req: Request, res: Response) => {
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
    const outputSequence: string[] = [];

    // transitions provided as JSON string in multipart: [{ id, time, duration? }, ...]
    const rawTransitions = req.body?.transitions as string | undefined;
    const transitions: Array<{ id: string; time: number; duration?: number }> = rawTransitions ? JSON.parse(rawTransitions) : [];
    if (!Array.isArray(transitions) || transitions.length === 0) {
      return res.status(400).json({ success: false, error: "No transitions provided" });
    }

    const service = new VideoTransitionService();
    let processedVideoPath = videoPath;
    const sorted = [...transitions].sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const stepOut = path.join(outputDir, `${videoName}-transition-${i + 1}-${timestamp}.mp4`);
      await service.addTransition(processedVideoPath, stepOut, t.id, { transitionTime: Number(t.time) || 0, duration: t.duration ?? 1.0 });
      if (processedVideoPath !== videoPath && fs.existsSync(processedVideoPath)) {
        try { fs.unlinkSync(processedVideoPath); } catch (_) {}
      }
      processedVideoPath = stepOut;
      outputSequence.push(stepOut);
    }

    const finalPath = processedVideoPath;
    const outputFileName = path.basename(finalPath);

    // cleanup original upload
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch (_) {}

    return res.json({ success: true, outputFile: outputFileName, downloadUrl: `/download/${outputFileName}`, videoPath: finalPath });
  } catch (error) {
    console.error("apply-transitions error:", error);
    return res.status(500).json({ success: false, error: "Failed to apply transitions" });
  }
});

// Apply only background audios to an uploaded video
editorRoutes.post("/apply-audio", upload.single("video"), async (req: Request, res: Response) => {
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

    // audios provided as JSON string in multipart: [{ id, startTime?, endTime?, volume?, fadeIn?, fadeOut?, loop? }, ...]
    const rawAudios = req.body?.audios as string | undefined;
    const audios: Array<{ id: string; startTime?: number; endTime?: number; volume?: number; fadeIn?: number; fadeOut?: number; loop?: boolean }> = rawAudios ? JSON.parse(rawAudios) : [];
    if (!Array.isArray(audios) || audios.length === 0) {
      return res.status(400).json({ success: false, error: "No audios provided" });
    }

    const service = new AudioOverlayService();
    let processedVideoPath = videoPath;
    for (let i = 0; i < audios.length; i++) {
      const a = audios[i];
      const stepOut = path.join(outputDir, `${videoName}-audio-${i + 1}-${timestamp}.mp4`);
      await service.addBackgroundAudio(processedVideoPath, stepOut, a.id, {
        startTime: a.startTime,
        endTime: a.endTime,
        volume: a.volume,
        fadeIn: a.fadeIn,
        fadeOut: a.fadeOut,
        loop: a.loop,
      });
      if (processedVideoPath !== videoPath && fs.existsSync(processedVideoPath)) {
        try { fs.unlinkSync(processedVideoPath); } catch (_) {}
      }
      processedVideoPath = stepOut;
    }

    const finalPath = processedVideoPath;
    const outputFileName = path.basename(finalPath);

    // cleanup original upload
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch (_) {}

    return res.json({ success: true, outputFile: outputFileName, downloadUrl: `/download/${outputFileName}`, videoPath: finalPath });
  } catch (error) {
    console.error("apply-audio error:", error);
    return res.status(500).json({ success: false, error: "Failed to apply background audio" });
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