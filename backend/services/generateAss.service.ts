import fs from 'fs';
import path from 'path';

function secondsToAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}
export function generateASS(transcription: { start: number, end: number, text: string }[], outputPath: string) {
    const assHeader = `
  [Script Info]
  Title: Auto Subtitles
  ScriptType: v4.00+
  
  [V4+ Styles]
  Format: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  Style: Default,Arial,36,&H00FFFFFF,&H80000000,-1,0,1,2,0,8,10,10,10,1
  
  [Events]
  Format: Start, End, Style, Text
  `;
  
    const events = transcription.map(item => {
      const start = secondsToAssTime(item.start);
      const end = secondsToAssTime(item.end);
      const text = item.text.replace(/,/g, '').replace(/\n/g, ' ').trim();
      return `Dialogue: ${start},${end},Default,${text}`;
    });
  
    fs.writeFileSync(outputPath, assHeader + events.join('\n'), 'utf-8');
  }