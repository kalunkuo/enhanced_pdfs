import { useCallback, useState } from 'react';
import { safeImage } from './comments';

export interface Profile {
    name: string;
    /** Small image data URL. */
    photo?: string;
}

const KEY = 'enhanced-pdf-viewer.profile';

export function loadProfile(): Profile {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { name?: unknown; photo?: unknown } | null;
        const name = typeof raw?.name === 'string' ? raw.name.slice(0, 80) : '';
        const photo = safeImage(raw?.photo);
        return { name, ...(photo ? { photo } : {}) };
    } catch {
        return { name: '' }; // storage unavailable or corrupt: start empty
    }
}

function storeProfile(profile: Profile): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(profile));
    } catch {
        // Private mode or a full quota: the profile still works for this session.
    }
}

/** The commenter's name and photo, remembered in this browser only. */
export function useProfile(): [Profile, (next: Profile) => void] {
    const [profile, setProfile] = useState<Profile>(loadProfile);
    const update = useCallback((next: Profile) => {
        // Not trimmed here: this runs on every keystroke, and a trailing space is part of typing "Yam Chum".
        const clean: Profile = { name: next.name.slice(0, 80), ...(next.photo ? { photo: next.photo } : {}) };
        setProfile(clean);
        storeProfile(clean);
    }, []);
    return [profile, update];
}

/**
 * Read an image file as a JPEG data URL no larger than `maxSide` pixels.
 * `square` crops to the center, for profile photos.
 */
export async function imageToDataUrl(file: File, maxSide: number, square = false, quality = 0.85): Promise<string> {
    const bitmap = await createImageBitmap(file);
    try {
        const side = square ? Math.min(bitmap.width, bitmap.height) : 0;
        const sx = square ? (bitmap.width - side) / 2 : 0;
        const sy = square ? (bitmap.height - side) / 2 : 0;
        const sw = square ? side : bitmap.width;
        const sh = square ? side : bitmap.height;
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is not available.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
    } finally {
        bitmap.close();
    }
}
