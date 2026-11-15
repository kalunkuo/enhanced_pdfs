import { useEffect, useRef, useState } from 'react';
import { imageToDataUrl, type Profile } from '../../lib/profile';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

/** Your name and photo, shown on the comments you write. Kept in this browser only. */
export function ProfileMenu({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
    const [open, setOpen] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('keydown', esc);
        };
    }, [open]);

    const choosePhoto = async (file: File | undefined) => {
        if (!file) return;
        try {
            setProblem(null);
            onChange({ ...profile, photo: await imageToDataUrl(file, 96, true) });
        } catch {
            setProblem('That file could not be read as an image.');
        }
    };

    return (
        <div className="profile-menu" ref={root}>
            <button className="icon-btn profile-btn" aria-label="Your profile" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
                <Avatar name={profile.name || '?'} photo={profile.photo} size={30} />
            </button>
            {open && (
                <div className="dropdown profile-pop" role="dialog" aria-label="Your profile">
                    <div className="profile-row">
                        <Avatar name={profile.name || '?'} photo={profile.photo} size={48} />
                        <div className="profile-actions">
                            <Button type="button" onClick={() => fileInput.current?.click()}>Upload photo</Button>
                            {profile.photo && <Button type="button" variant="ghost" onClick={() => onChange({ name: profile.name })}>Remove</Button>}
                        </div>
                    </div>
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ''; }} />
                    <label className="profile-name">
                        <span className="muted">Name shown on your comments</span>
                        <input className="search" value={profile.name} maxLength={80} placeholder="Your name" onChange={(e) => onChange({ ...profile, name: e.target.value })} />
                    </label>
                    {problem && <div className="cproblem" role="alert">{problem}</div>}
                </div>
            )}
        </div>
    );
}
