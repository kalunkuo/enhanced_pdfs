import { useEffect, useState } from 'react';

/** The current time, refreshed on an interval, so "just now" turns into "1 min ago" without a reload. */
export function useNow(intervalMs = 30_000): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
