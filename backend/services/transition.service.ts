import * as fs from "fs";
import * as path from "path";

export interface Transition {
  id: string;
  filename: string;
  name: string;
  duration?: number;
  type?: string;
  category?: string;
}

export class TransitionService {
  private static readonly TRANSITION_DIR = path.join(process.cwd(), 'assets', 'transitions');
  private static readonly MANIFEST_FILE = path.join(this.TRANSITION_DIR, 'manifest.json');

  /**
   * Get all available transitions
   */
  static getAvailableTransitions(): Transition[] {
    try {
      if (fs.existsSync(this.MANIFEST_FILE)) {
        const manifest = JSON.parse(fs.readFileSync(this.MANIFEST_FILE, 'utf8'));
        return manifest.transitions || [];
      }
    } catch (error) {
      console.warn('Failed to read manifest, falling back to file system scan:', error);
    }

    // Fallback: scan directory for video files
    if (!fs.existsSync(this.TRANSITION_DIR)) {
      return [];
    }

    return fs.readdirSync(this.TRANSITION_DIR)
      .filter(file => file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.avi'))
      .map(file => ({
        id: path.parse(file).name,
        filename: file,
        name: path.parse(file).name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      }));
  }

  /**
   * Get a specific transition by ID
   */
  static getTransitionById(id: string): Transition | null {
    const transitions = this.getAvailableTransitions();
    return transitions.find(transition => transition.id === id) || null;
  }

  /**
   * Get the full file path for a transition
   */
  static getTransitionPath(filename: string): string {
    return path.join(this.TRANSITION_DIR, filename);
  }

  /**
   * Check if a transition file exists
   */
  static transitionExists(filename: string): boolean {
    return fs.existsSync(this.getTransitionPath(filename));
  }

  /**
   * Create or update the manifest file
   */
  static updateManifest(transitions: Transition[]): void {
    const manifest = { transitions };
    fs.writeFileSync(this.MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  }

  /**
   * Get transitions by category
   */
  static getTransitionsByCategory(category: string): Transition[] {
    const transitions = this.getAvailableTransitions();
    return transitions.filter(transition => 
      transition.category?.toLowerCase().includes(category.toLowerCase())
    );
  }
}
