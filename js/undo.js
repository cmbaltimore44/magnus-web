import { supabase } from './supabaseClient.js';
import { showActionToast, showError, showToast } from './toast.js';
import { notifyDataChanged } from './events.js';
import { isMissingSchema } from './schema.js';

// Undo after delete: capture the exact rows a delete will remove (the row
// itself plus anything the database cascades) or modify (foreign keys it
// sets to null), delete, then offer an "Undo" toast that puts them back
// with the same ids.

const UNDO_MS = 8000;

async function selectWhere(table, column, value) {
  const { data, error } = await supabase.from(table).select('*').eq(column, value);
  if (error) {
    if (isMissingSchema(error)) return []; // e.g. focus_sessions before schema_003
    throw error;
  }
  return data;
}

async function insertRows(table, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw error;
}

// del:       performs the delete (the existing data-layer call)
// table, id: the row being deleted
// cascades:  [{ table, column }] child rows deleted with it (on delete cascade)
// relinks:   [{ table, column }] rows whose column is set to null (on delete set null)
// onRestored: optional callback after a successful undo
export async function deleteWithUndo({ message, table, id, del, cascades = [], relinks = [], onRestored }) {
  const [own, ...rest] = await Promise.all([
    selectWhere(table, 'id', id),
    ...cascades.map((c) => selectWhere(c.table, c.column, id)),
    ...relinks.map((r) => selectWhere(r.table, r.column, id)),
  ]);
  const children = cascades.map((c, i) => ({ table: c.table, rows: rest[i] }));
  const links = relinks.map((r, i) => ({ ...r, ids: rest[cascades.length + i].map((row) => row.id) }));

  await del();

  showActionToast(message, {
    actionLabel: 'Undo',
    duration: UNDO_MS,
    onAction: async () => {
      try {
        await insertRows(table, own);
        for (const child of children) await insertRows(child.table, child.rows);
        for (const link of links) {
          if (!link.ids.length) continue;
          const { error } = await supabase.from(link.table).update({ [link.column]: id }).in('id', link.ids);
          if (error) throw error;
        }
        showToast('Restored.', { type: 'success', duration: 2500 });
        notifyDataChanged('undo');
        if (onRestored) await onRestored();
      } catch (err) {
        showError(err);
      }
    },
  });
}
