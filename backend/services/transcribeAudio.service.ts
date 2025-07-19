import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const API_KEY = process.env.ASSEMBLY_API_KEY;

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

async function uploadAudio(filePath: string): Promise<string> {
  const fileStream = fs.createReadStream(filePath);
  const response = await axios.post('https://api.assemblyai.com/v2/upload', fileStream, {
    headers: {
      'authorization': API_KEY,
      'transfer-encoding': 'chunked',
    },
  });
  return response.data.upload_url;
}

async function startTranscription(audioUrl: string): Promise<string> {
  const response = await axios.post('https://api.assemblyai.com/v2/transcript', {
    audio_url: audioUrl,
    word_boost: [], // Optional: boost specific words
    punctuate: true,
    format_text: true,
  }, {
    headers: {
      'authorization': API_KEY,
      'content-type': 'application/json',
    },
  });
  return response.data.id;
}

async function pollTranscription(transcriptId: string): Promise<TranscriptionSegment[]> {
  const endpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

  while (true) {
    const response = await axios.get(endpoint, {
      headers: { authorization: API_KEY },
    });

    const status = response.data.status;
    if (status === 'completed') {
      // Extract timed segments from the response
      const words = response.data.words || [];
      const segments: TranscriptionSegment[] = [];
      
      // Group words into segments (you can adjust the grouping logic)
      let currentSegment: TranscriptionSegment | null = null;
      const segmentDuration = 1; // Group words into 3-second segments
      
      for (const word of words) {
        const wordStart = word.start / 1000; // Convert to seconds
        const wordEnd = word.end / 1000;
        
        if (!currentSegment || wordStart - currentSegment.start >= segmentDuration) {
          // Start new segment
          if (currentSegment) {
            segments.push(currentSegment);
          }
          currentSegment = {
            start: wordStart,
            end: wordEnd,
            text: word.text
          };
        } else {
          // Add to current segment
          currentSegment.end = wordEnd;
          currentSegment.text += ' ' + word.text;
        }
      }
      
      // Add the last segment
      if (currentSegment) {
        segments.push(currentSegment);
      }
      
      return segments;
    } else if (status === 'error') {
      throw new Error(`Transcription failed: ${response.data.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function transcribeAudio(filePath: string): Promise<TranscriptionSegment[]> {
  try {
    const audioUrl = await uploadAudio(filePath);
    const transcriptId = await startTranscription(audioUrl);
    const segments = await pollTranscription(transcriptId);
    return segments;
  } catch (err) {
    console.error('Error during transcription:', err);
    throw err;
  }
}

