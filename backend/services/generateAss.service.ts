import fs from 'fs';

function secondsToAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function generateASS(transcription: { start: number, end: number, text: string }[], outputPath: string) {
    
    const assHeader = `[Script Info]
Title: Social Media Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Segoe UI,14,&H00000000,&H00FFFFFF,1,0,1,0,0,8,30,30,20,1

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

