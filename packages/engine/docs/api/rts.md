# engine.rts — rts(opts?: RtsOptions)

(experimental) RTS match view and controls (rts() module): units, selection, orders, fog, minimap

- Options `RtsOptions`:
  - `driver: any` The match driver from
  - `look?: Record<string, RtsLook>` How each unit kind is drawn: { [kind]: RtsLook }; the key "projectile" draws shots in flight
  - `teamColors?: Array<import('three').ColorRepresentation>` A color per team index, anything THREE.Color takes. Without it each team is a different gray
  - `controls?: boolean` false turns off the built-in mouse and keys: the game calls engine.rts.select and engine.rts.issue itself (default true)
  - `minimap?: boolean` A minimap canvas (CSS class threedog-rts-minimap) in the lower-left corner (default true)
  - `fog?: boolean` A dark overlay on the ground for what the local team has not seen; false keeps only the fog texture (default true)

## Methods and properties
- `rts.select(ids: number[]) → readonly number[]` — Select units by entity id. Ids that are not alive, or not the local player's, are dropped. Returns the new selection. Example: `engine.rts.select([engine.rts.sim.entities.find(u => u.owner === 0).id]);`
- `rts.issue(cmd: Record<string, any>) → string` — Give a command as the local player: { t: 'move', ids, x, z, queue? } with x and z fixed (fx(meters)). Returns '' or why it was refused. Example: `engine.rts.issue({ t: 'move', ids: engine.rts.selection.slice(), x: fx(20), z: fx(-5) });`
- Properties:
  - `driver: any` The match driver given to rts()
  - `sim: any` The sim (read it, never change it)
  - `selection: readonly number[]` Entity ids of the selected units, all the local player's own (read only: change it with select)
  - `meshes: Record<string, import('three').InstancedMesh>` The unit meshes by kind name: plain InstancedMesh, so castShadow, layers and renderOrder are yours
  - `ringMaterial: import('three').Material` The selection ring's material (neutral gray; restyle it)
  - `barMaterial: import('three').Material` The filled part of a health bar
  - `barBackMaterial: import('three').Material` The empty part behind a health bar
  - `fog: RtsFog | null` The fog overlay and texture; null for an observer or a sim without the vision system
