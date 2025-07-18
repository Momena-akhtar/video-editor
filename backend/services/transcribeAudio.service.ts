import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const API_KEY = process.env.ASSEMBLY_API_KEY;

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
  }, {
    headers: {
      'authorization': API_KEY,
      'content-type': 'application/json',
    },
  });
  return response.data.id;
}

async function pollTranscription(transcriptId: string): Promise<string> {
  const endpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

  while (true) {
    const response = await axios.get(endpoint, {
      headers: { authorization: API_KEY },
    });

    const status = response.data.status;
    if (status === 'completed') {
      return response.data.text;
    } else if (status === 'error') {
      throw new Error(`Transcription failed: ${response.data.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function transcribeAudio(filePath: string) {
  try {
    const audioUrl = await uploadAudio(filePath);
    const transcriptId = await startTranscription(audioUrl);
    const transcriptText = await pollTranscription(transcriptId);
    return transcriptText;
  } catch (err) {
    console.error('Error during transcription:', err);
  }
}

