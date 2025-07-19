// services/burnSubtitles.service.ts
import ffmpeg from 'fluent-ffmpeg';

export function burnSubtitles(videoPath: string, assPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .videoFilter(`ass=${assPath}`)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}
