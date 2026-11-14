import { avatarColor, initials } from '../../lib/comments';

/** A profile photo, or the person's initial on a stable color. */
export function Avatar({ name, photo, size = 32 }: { name: string; photo?: string | undefined; size?: number }) {
    return (
        <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: photo ? undefined : avatarColor(name || '?') }} aria-hidden="true">
            {photo ? <img src={photo} alt="" /> : initials(name)}
        </span>
    );
}
