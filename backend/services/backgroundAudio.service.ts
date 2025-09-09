import * as fs from "fs";
import * as path from "path";

export interface BackgroundTrack {
  id: string;
  filename: string;
  name: string;
  duration?: number;
  mood?: string;
  bpm?: number;
}

export class BackgroundAudioService {
  private static readonly AUDIO_DIR = path.join(process.cwd(), 'assets', 'background-audio');
  private static readonly MANIFEST_FILE = path.join(this.AUDIO_DIR, 'manifest.json');

  /**
   * Get all available background audio tracks
   */
  static getAvailableTracks(): BackgroundTrack[] {
    try {
      if (fs.existsSync(this.MANIFEST_FILE)) {
        const manifest = JSON.parse(fs.readFileSync(this.MANIFEST_FILE, 'utf8'));
        return manifest.tracks || [];
      }
    } catch (error) {
      console.warn('Failed to read manifest, falling back to file system scan:', error);
    }

    // Fallback: scan directory for MP3 files
    if (!fs.existsSync(this.AUDIO_DIR)) {
      return [];
    }

    return fs.readdirSync(this.AUDIO_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        id: path.parse(file).name,
        filename: file,
        name: path.parse(file).name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      }));
  }

  /**
   * Get a specific track by ID
   */
  static getTrackById(id: string): BackgroundTrack | null {
    const tracks = this.getAvailableTracks();
    return tracks.find(track => track.id === id) || null;
  }

  /**
   * Get the full file path for a track
   */
  static getTrackPath(filename: string): string {
    return path.join(this.AUDIO_DIR, filename);
  }

  /**
   * Check if a track file exists
   */
  static trackExists(filename: string): boolean {
    return fs.existsSync(this.getTrackPath(filename));
  }

  /**
   * Create or update the manifest file
   */
  static updateManifest(tracks: BackgroundTrack[]): void {
    const manifest = { tracks };
    fs.writeFileSync(this.MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  }

  /**
   * Get tracks by mood/category
   */
  static getTracksByMood(mood: string): BackgroundTrack[] {
    const tracks = this.getAvailableTracks();
    return tracks.filter(track => 
      track.mood?.toLowerCase().includes(mood.toLowerCase())
    );
  }
}
