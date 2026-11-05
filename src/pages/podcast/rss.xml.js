import data from '../../../config/podcast.json' with { type: 'json' };
import { createPodcastFeed } from '../../data/podcast-feed.mjs';

export function GET() {
  return new Response(createPodcastFeed(data), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
