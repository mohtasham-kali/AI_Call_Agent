import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

async function getContacts() {
  const store = getStore({ name: 'contacts', consistency: 'strong' })
  const index = await store.get('_index', { type: 'json' }) as number[] | null
  if (!index || index.length === 0) return []

  const contacts = []
  for (const id of index) {
    const contact = await store.get(`contact-${id}`, { type: 'json' })
    if (contact) contacts.push(contact)
  }
  return contacts.sort((a: any, b: any) => b.id - a.id)
}

async function getNextId() {
  const store = getStore({ name: 'contacts', consistency: 'strong' })
  const counter = await store.get('_counter', { type: 'text' })
  const nextId = counter ? parseInt(counter) + 1 : 1
  await store.set('_counter', String(nextId))
  return nextId
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'contacts', consistency: 'strong' })

  if (req.method === 'GET') {
    const contacts = await getContacts()
    return Response.json(contacts)
  }

  if (req.method === 'POST') {
    // Create a new contact
    const body = await req.json()
    const id = await getNextId()
    const contact = {
      id,
      name: body.name || 'Unknown',
      phone_number: body.phone_number || '',
      context: body.context || 'General inquiry',
      status: 'pending',
      notes: null,
      call_sid: null,
    }
    await store.setJSON(`contact-${id}`, contact)

    const index = (await store.get('_index', { type: 'json' }) as number[] | null) || []
    index.push(id)
    await store.setJSON('_index', index)

    return Response.json(contact, { status: 201 })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/contacts',
  method: ['GET', 'POST'],
}
