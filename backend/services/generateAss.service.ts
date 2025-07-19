import fs from 'fs';
import path from 'path';
import https from 'https';

// Function to download font from Google Fonts
async function downloadFont(fontName: string, outputPath: string): Promise<boolean> {
    const fontUrl = `https://fonts.googleapis.com/css2?family=Kumbh+Sans:wght@200..900&display=swap`;
    
    return new Promise((resolve) => {
        const file = fs.createWriteStream(outputPath);
        https.get(fontUrl, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(true);
                });
            } else {
                resolve(false);
            }
        }).on('error', () => {
            resolve(false);
        });
    });
}

// Function to embed font in ASS file
function embedFontInASS(fontPath: string): string {
    if (!fs.existsSync(fontPath)) {
        return '';
    }
    
    const fontData = fs.readFileSync(fontPath);
    const base64Font = fontData.toString('base64');
    
    return `[Fonts]
@font-face {
    font-family: "Kumbh Sans";
    src: url(data:font/woff2;base64,${base64Font}) format("woff2");
}

`;
}

function secondsToAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export async function generateASS(transcription: { start: number, end: number, text: string }[], outputPath: string, useCustomFont: boolean = false) {
    let fontEmbedSection = '';
    let fontName = 'Arial';
    
    if (useCustomFont) {
        const fontDir = path.join(process.cwd(), 'fonts');
        const fontPath = path.join(fontDir, 'kumbh-sans.woff2');
        
        // Create fonts directory if it doesn't exist
        if (!fs.existsSync(fontDir)) {
            fs.mkdirSync(fontDir, { recursive: true });
        }
        
        // Download font if it doesn't exist
        if (!fs.existsSync(fontPath)) {
            const success = await downloadFont('Kumbh Sans', fontPath);
            if (success) {
                fontEmbedSection = embedFontInASS(fontPath);
                fontName = 'Kumbh Sans';
            }
        } else {
            fontEmbedSection = embedFontInASS(fontPath);
            fontName = 'Kumbh Sans';
        }
    }
    
    const assHeader = `[Script Info]
Title: Social Media Subtitles
ScriptType: v4.00+
${fontEmbedSection}[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},14,&H00000000,&H00FFFFFF,0,0,1,0,0,8,30,30,20,1

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

// Alternative simpler version using just background box with system font
export function generateSimpleBoxASS(transcription: { start: number, end: number, text: string }[], outputPath: string) {
    const assHeader = `[Script Info]
Title: Social Media Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,22,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,2,0,1,0,0,2,30,30,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  
    const events = transcription.map(item => {
        const start = secondsToAssTime(item.start);
        const end = secondsToAssTime(item.end);
        const text = item.text.replace(/,/g, '').replace(/\n/g, ' ').trim();
        return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    });
  
    fs.writeFileSync(outputPath, assHeader + events.join('\n'), 'utf-8');
}