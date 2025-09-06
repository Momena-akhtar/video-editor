import { ZoomEffectService } from "./zoomEffect.service";

export interface MultiZoomResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface MultiZoomOptions {
  sentencesPerZoom?: number;
  bufferSec?: number;
  startZoom?: number;
  endZoom?: number;
  durationSec?: number;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export async function applyMultiZoom(
  inputPath: string, 
  outputPath: string, 
  segments: any[], 
  options: MultiZoomOptions = {}
): Promise<MultiZoomResult> {
  try {
    const zoomService = new ZoomEffectService();
    
    await zoomService.applyMultiZoomEffect(inputPath, outputPath, segments, {
      sentencesPerZoom: options.sentencesPerZoom ?? 2,
      bufferSec: options.bufferSec ?? 0.2,
      startZoom: options.startZoom ?? 1.0,
      endZoom: options.endZoom ?? 1.15,
      durationSec: options.durationSec ?? 1.0,
      easing: options.easing ?? "ease-in-out",
    });

    return {
      success: true,
      outputPath: outputPath
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error)
    };
  }
}
