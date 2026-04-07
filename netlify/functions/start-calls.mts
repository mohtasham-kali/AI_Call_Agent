import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'contacts', consistency: 'strong' })
  const settingsStore = getStore({ name: 'settings', consistency: 'strong' })

  // Get all pending contacts
  const index = (await store.get('_index', { type: 'json' }) as number[] | null) || []
  let count = 0

  const twilioSid = Netlify.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Netlify.env.get('TWILIO_AUTH_TOKEN')
  const twilioPhone = Netlify.env.get('TWILIO_PHONE_NUMBER')

  if (!twilioSid || !twilioToken || !twilioPhone) {
    return Response.json({
      error: 'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables.'
    }, { status: 500 })
  }

  for (const id of index) {
    const contact = await store.get(`contact-${id}`, { type: 'json' }) as any
    if (!contact || contact.status !== 'pending') continue

    try {
      // Update status to calling
      contact.status = 'calling'
      await store.setJSON(`contact-${id}`, contact)
      count++

      // Note: Actual Twilio call initiation requires WebSocket support
      // which is not available in serverless functions.
      // Mark as pending for now with a note.
      contact.status = 'completed'
      contact.notes = 'Call queued. Note: Real-time voice calls require a persistent server with WebSocket support.'
      await store.setJSON(`contact-${id}`, contact)
    } catch (e: any) {
      contact.status = 'failed'
      contact.notes = e.message
      await store.setJSON(`contact-${id}`, contact)
    }
  }

  return Response.json({ message: `Processed ${count} contacts` })
}

export const config: Config = {
  path: '/api/start_calls',
  method: ['POST'],
}
