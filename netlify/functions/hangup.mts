import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'contacts', consistency: 'strong' })
  const id = context.params.id

  const contact = await store.get(`contact-${id}`, { type: 'json' }) as any
  if (!contact) {
    return Response.json({ error: 'Contact not found' }, { status: 404 })
  }

  contact.status = 'failed'
  contact.notes = 'Terminated manually'
  await store.setJSON(`contact-${id}`, contact)

  return Response.json({ message: 'Call terminated' })
}

export const config: Config = {
  path: '/api/contacts/:id/hangup',
  method: ['POST'],
}
