import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'contacts', consistency: 'strong' })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return Response.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const text = await file.text()
  const lines = text.split('\n').filter(line => line.trim())
  if (lines.length === 0) {
    return Response.json({ error: 'Empty CSV file' }, { status: 400 })
  }

  // Parse header
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''))

  const nameIdx = headers.findIndex(h => ['name', 'fullname', 'contactname'].includes(h))
  const phoneIdx = headers.findIndex(h => ['phonenumber', 'phone', 'number', 'mobile', 'cell'].includes(h))
  const contextIdx = headers.findIndex(h => ['context', 'details', 'notes', 'message', 'directive'].includes(h))

  const contacts = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim())
    if (values.length === 0 || !values.some(v => v)) continue

    const name = nameIdx >= 0 ? values[nameIdx] : 'Unknown'
    let phone = phoneIdx >= 0 ? values[phoneIdx] : ''
    const ctx = contextIdx >= 0 ? values[contextIdx] : 'General inquiry'

    // Normalize phone numbers
    if (phone) {
      phone = phone.trim()
      if (phone.startsWith('03') && phone.length === 11) {
        phone = '+92' + phone.substring(1)
      } else if (phone.startsWith('3') && phone.length === 10) {
        phone = '+92' + phone
      } else if (!phone.startsWith('+')) {
        phone = '+' + phone
      }
    }

    // Get next ID
    const counter = await store.get('_counter', { type: 'text' })
    const nextId = counter ? parseInt(counter) + 1 : 1
    await store.set('_counter', String(nextId))

    const contact = {
      id: nextId,
      name: name || 'Unknown',
      phone_number: phone,
      context: ctx || 'General inquiry',
      status: 'pending',
      notes: null,
      call_sid: null,
    }
    await store.setJSON(`contact-${nextId}`, contact)

    const index = (await store.get('_index', { type: 'json' }) as number[] | null) || []
    index.push(nextId)
    await store.setJSON('_index', index)

    contacts.push(contact)
  }

  return Response.json({ message: `CSV uploaded successfully. ${contacts.length} contacts imported.` })
}

export const config: Config = {
  path: '/api/upload_csv',
  method: ['POST'],
}
