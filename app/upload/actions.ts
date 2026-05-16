'use server';

import { updateTag } from 'next/cache';

export async function refreshTrackerCache() {
  updateTag('tracker-data');
}
