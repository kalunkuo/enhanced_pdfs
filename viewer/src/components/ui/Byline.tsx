import { formatExactDate, formatTimeAgo } from '../../lib/comments';
import { Avatar } from './Avatar';

/** Who wrote something and when: avatar, name, exact date and how long ago. */
export function Byline({ author, createdAt, now, size = 32 }: { author: { name: string; photo?: string | undefined } | undefined; createdAt: string | undefined; now: number; size?: number }) {
    const name = author?.name ?? 'Unknown author';
    const exact = formatExactDate(createdAt);
    return (
        <div className="byline">
            <Avatar name={author?.name ?? '?'} photo={author?.photo} size={size} />
            <div className="byline-text">
                <strong>{name}</strong>
                <span className="muted" title={createdAt}>{exact ? `${exact} · ${formatTimeAgo(createdAt, now)}` : 'No date recorded'}</span>
            </div>
        </div>
    );
}
