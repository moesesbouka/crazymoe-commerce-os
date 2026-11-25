const hash = /^[a-f0-9]{64}$/;
const objectPath = /^(?:(?:originals|references|exports)\/|incoming\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/)([a-f0-9]{64})$/;

export function validateRequest(value) {
  if (!value || !/^recovery\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-f0-9-]{36}\.json\.gz$/.test(value.path)
      || !hash.test(value.sha256)) throw Error("Invalid recovery request");
  return {path: value.path, sha256: value.sha256};
}

export function mediaManifest(doc) {
  if (doc?.format !== 1 || !doc.tables) throw Error("Invalid snapshot");
  const objects = new Map();
  const rows = name => {
    const table = doc.tables[name];
    if (!table || !Array.isArray(table.rows) || table.count !== table.rows.length)
      throw Error("Incomplete snapshot");
    return table.rows;
  };
  const add = (path, sha, bytes) => {
    if (typeof path !== "string" || objectPath.exec(path)?.[1] !== sha
        || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 35 * 1024 * 1024)
      throw Error("Invalid media reference");
    if (objects.has(path) && objects.get(path).bytes !== bytes) throw Error("Conflicting media references");
    objects.set(path, {path, sha256: sha, bytes});
  };
  for (const name of ["photo_assets", "reference_assets"]) for (const row of rows(name)) {
    if (row.bucket !== "studio-originals") throw Error("Unexpected bucket");
    add(row.object_path, row.sha256, row.bytes);
  }
  for (const row of rows("photo_choices")) add("exports/" + row.choice, row.choice, row.image.bytes);
  for (const row of rows("export_sets")) for (const img of row.images) add("exports/" + img.sha, img.sha, img.bytes);
  return [...objects.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
