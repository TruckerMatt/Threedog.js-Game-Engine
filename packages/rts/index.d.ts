// Types for @threedog/rts (the deterministic RTS simulation). Guide: docs/RTS.md. Fixed values are plain numbers holding meters × 65536.

/** A fixed-point number: meters (or any real value) × 65536, always an integer */
export type Fixed = number;
/** An angle: 0..65535 for one full turn (0 = +x, 16384 = +z) */
export type Angle = number;

export const SHIFT: 16;
export const ONE: 65536;
export const HALF: 32768;
export const ANGLE: 65536;
export function fx(n: number): Fixed;
export function toFloat(f: Fixed): number;
export function fromInt(n: number): Fixed;
export function floorInt(f: Fixed): number;
export function mul(a: Fixed, b: Fixed): Fixed;
export function div(a: Fixed, b: Fixed): Fixed;
export function sqrt(a: Fixed): Fixed;
export function len(dx: Fixed, dz: Fixed): Fixed;
export function len2(dx: Fixed, dz: Fixed): number;
export function dist2Of(r: Fixed): number;
export function clamp(v: number, lo: number, hi: number): number;
export function lerp(a: Fixed, b: Fixed, t: Fixed): Fixed;
export function wrapAngle(a: number): Angle;
export function sin(a: Angle): Fixed;
export function cos(a: Angle): Fixed;
export function atan2(z: number, x: number): Angle;
export function angleDiff(a: Angle, b: Angle): number;
export function angleToRadians(a: Angle): number;

export class Rng {
  constructor(seed?: number);
  state: number;
  next(): number;
  int(n: number): number;
  range(lo: number, hi: number): number;
  chance(p: Fixed): boolean;
  pick<T>(list: readonly T[]): T;
}
export class Hasher {
  int(v: number): this;
  str(s: string): this;
  readonly value: number;
}
export function hashString(s: string): number;
export function hex(h: number): string;

// ---- content ----

export const TICK_RATE: 20;
export interface UnitDef {
  hp: number; speed?: number; radius: number; sight?: number; armor?: string; weapons?: string[]; turnRate?: number; cost?: number;
  air?: boolean; tags?: string[]; build?: { time?: number; requires?: string[] }; produces?: string[]; supply?: number;
  gather?: { amount?: number; time?: number }; structure?: boolean; footprint?: [number, number]; income?: number; capture?: boolean; deployTime?: number;
}
export interface WeaponDef {
  range: number; minRange?: number; damage: number; cooldown: number; damageType?: string; projectileSpeed?: number; splash?: number;
  targets?: Array<'ground' | 'air'>; arc?: boolean; turret?: boolean;
}
export interface ContentDef {
  units: Record<string, UnitDef>; weapons?: Record<string, WeaponDef>; armor?: Record<string, Record<string, number>>;
  factions?: Record<string, unknown>; modes?: Record<string, unknown>;
}
export interface Weapon { name: string; range: Fixed; minRange: Fixed; damage: Fixed; cooldown: number; damageType: string; projectileSpeed: Fixed; splash: Fixed; targets: string[]; arc: boolean; turret?: boolean }
/** A unit kind after loading: numbers are fixed or ticks */
export interface Kind {
  name: string; index: number; hp: Fixed; speed: Fixed; radius: Fixed; sight: Fixed; turnRate: number; armor: string; air: boolean; structure: boolean;
  cost: number; supply: number; income: Fixed; capture: boolean; deployTime: number; tags: string[]; produces: string[]; footprint: [number, number] | null;
  build: { time: number; requires: string[] } | null; gather: { amount: number; time: number } | null; weapons: Weapon[]; range: Fixed; hash: number;
}
export interface Content {
  kinds: Kind[]; kind: Record<string, Kind>; weapons: Record<string, Weapon>; armor: Record<string, Record<string, Fixed>>;
  factions: Record<string, unknown>; modes: Record<string, unknown>; hash: number; raw: ContentDef;
}
export function loadContent(raw: ContentDef): Content;
export function armorFactor(content: Content, armor: string, damageType: string): Fixed;

// ---- map ----

export interface MapOptions {
  width: number; depth: number; cell?: number; originX?: number; originZ?: number;
  height?: (x: number, z: number) => number; blocked?: (x: number, z: number) => boolean;
  heights?: ArrayLike<number>; blocks?: ArrayLike<number>;
}
export interface SimMap {
  cell: Fixed; cellM: number; cols: number; rows: number; originX: Fixed; originZ: Fixed; height: Int32Array; block: Uint8Array; hash: number; version?: number;
  width: Fixed; depth: Fixed; minX: Fixed; minZ: Fixed; maxX: Fixed; maxZ: Fixed;
  cellX(x: Fixed): number; cellZ(z: Fixed): number; cellAt(x: Fixed, z: Fixed): number; centerX(cx: number): Fixed; centerZ(cz: number): Fixed;
  heightAt(x: Fixed, z: Fixed): Fixed; inside(x: Fixed, z: Fixed): boolean; isBlocked(cx: number, cz: number): boolean;
  copy(): SimMap; setBlocked(cells: Iterable<number>, v: boolean | number): void; toJSON(): object;
}
export function createMap(o: MapOptions): SimMap;
export function mapFromJSON(j: object): SimMap;

// ---- the sim ----

/** A command as it travels: positions fixed, p set by the driver or relay */
export type Command =
  | { p?: number; t: 'move' | 'amove' | 'patrol'; ids: number[]; x: Fixed; z: Fixed; queue?: 0 | 1 }
  | { p?: number; t: 'attack'; ids: number[]; target: number; queue?: 0 | 1 }
  | { p?: number; t: 'stop' | 'hold'; ids: number[] }
  | { p?: number; t: 'reinforce'; kinds: string[]; x: Fixed; z: Fixed }
  | { p?: number; t: 'build'; kind: string; x: Fixed; z: Fixed }
  | { p?: number; t: 'produce'; id: number; kind: string; count?: number }
  | { p?: number; t: 'cancel'; id: number }
  | { p?: number; t: 'rally'; id: number; x: Fixed; z: Fixed }
  | { p?: number; t: 'gather'; ids: number[]; target: number }
  | { p?: number; t: string; [arg: string]: unknown };

export interface Entity {
  id: number; kind: number; owner: number; x: Fixed; z: Fixed; facing: Angle; hp: Fixed; vx: Fixed; vz: Fixed; target: number; state: number;
  orders: Array<{ t: string; [k: string]: number | string }>; dead?: boolean; [field: string]: unknown;
}
export interface Player { index: number; team: number; name: string; faction: string | null; bot: BotOptions | null; alive: boolean; left: boolean; res: number; score: number }
export interface SimEvent { type: string; tick: number; [k: string]: unknown }
export interface View { tick: number; n: number; id: Int32Array; kind: Int16Array; owner: Int8Array; x: Float32Array; z: Float32Array; y: Float32Array; facing: Uint16Array; hp: Int16Array; flags: Uint8Array }
export interface System {
  name: string; init?(sim: Sim): void; step?(sim: Sim): void; hash?(sim: Sim, h: Hasher): void; save?(sim: Sim): unknown; load?(sim: Sim, data: any): void;
  afterLoad?(sim: Sim, data: any): void; describe?(sim: Sim): unknown; spawned?(sim: Sim, e: Entity): void;
}
export interface Snapshot { v: 1; tick: number; nextId: number; seed: number; rng: number; players: Player[]; entities: Entity[]; systems: Record<string, unknown> }
export interface Sim {
  content: Content; map: SimMap; tickRate: number; tick: number; nextId: number; seed: number; rng: Rng; players: Player[]; teams: number[];
  entities: Entity[]; byId: Map<number, Entity>; events: SimEvent[]; rejected: Array<{ tick: number; p: number; t: string; why: string }>; systems: System[];
  ended?: boolean; winner?: number; endReason?: string; teamScore?: Record<number, number>;
  /** present with the matching systems installed */
  vision?: { visible(team: number, x: Fixed, z: Fixed): boolean; explored(team: number, x: Fixed, z: Fixed): boolean; seen(team: number, e: Entity): boolean;
    grid(team: number): { cols: number; rows: number; cell: number; originX: number; originZ: number; visible: Uint8Array; explored: Uint8Array }; [k: string]: any };
  spatial?: { near(x: Fixed, z: Fixed, r: Fixed, fn: (e: Entity) => void): void; nearEnemies(team: number, x: Fixed, z: Fixed, r: Fixed, fn: (e: Entity) => void): void; [k: string]: any };
  capture?: { points: Array<{ id: string; x: Fixed; z: Fixed; radius: Fixed; value: number; holder: number; amount: number; contested: number }> };
  reinforce?: { zones: Array<{ team: number; x: Fixed; z: Fixed; radius: Fixed }>; pending: Array<{ p: number; kinds: string[]; x: Fixed; z: Fixed; at: number }>; refunds: unknown[];
    zonesOf(team: number): Array<{ team: number; x: Fixed; z: Fixed; radius: Fixed }>; [k: string]: any };
  base?: { canPlace(p: number, kind: string, x: Fixed, z: Fixed): string; supply(p: number): { used: number; cap: number }; [k: string]: any };
  projectiles?: Array<{ id: number; by: number; owner: number; w: string; x: Fixed; z: Fixed; tx: Fixed; tz: Fixed; target: number }>;
  [k: string]: any;
  field(name: string, def?: unknown): void;
  defineCommand(type: string, handler: { validate(sim: Sim, cmd: any): string; apply(sim: Sim, cmd: any): void }): void;
  spawn(kind: string, at: { owner: number; x: Fixed; z: Fixed; facing?: Angle }): Entity;
  kindOf(e: Entity): Kind;
  teamOf(e: Entity): number;
  get(id: number): Entity | null;
  kill(e: Entity, by?: number): void;
  emit(ev: { type: string; [k: string]: unknown }): void;
  step(cmds?: Command[]): SimEvent[];
  run(cmd: Command): string;
  hash(): number;
  snapshot(): Snapshot;
  restore(snap: Snapshot): void;
  describe(): { tick: number; seconds: number; hash: string; entities: number; players: Array<Record<string, unknown>>; rejected: unknown[]; [system: string]: unknown };
  view(): View;
  install(s: System): void;
}
export interface PlayerSetup { name?: string; team?: number; faction?: string; bot?: BotOptions }
export interface SimOptions { seed?: number; content: Content; map: SimMap; players: PlayerSetup[]; systems?: System[] }
export function createSim(o: SimOptions): Sim;
export function installSystem(sim: Sim, s: System): void;
export function restoreSim(opts: SimOptions, snap: Snapshot): Sim;
export function ticks(seconds: number): number;
export function perTick(metersPerSecond: number): Fixed;
export function defaultSystems(o?: { vision?: { cellsPerVision?: number }; extra?: System[] }): System[];
export function createMatch(o: Omit<SimOptions, 'systems'> & { vision?: { cellsPerVision?: number }; extra?: System[] }): Sim;

export function flowField(sim: Sim, goal: number, force?: boolean): { goal: number; cost: Uint32Array; dir: Uint8Array } | null;
export function openCellNear(m: SimMap, cell: number): number;
export function spatialSystem(): System;
export function visionSystem(o?: { cellsPerVision?: number }): System;
export function unitsSystem(): System;
export function combatSystem(): System;
export function formation(sim: Sim, units: Entity[], tx: Fixed, tz: Fixed): Array<{ e: Entity; x: Fixed; z: Fixed }>;
export const IDLE: 0, MOVING: 1, ENGAGING: 2, HOLDING: 3, MAX_IDS: 500;

// ---- modes and bots (options in meters and seconds) ----

export interface BotOptions { level?: 'easy' | 'normal' | 'hard'; mix?: Record<string, number>; workers?: number; attackAt?: number; buildOrder?: string[]; army?: string[] }
export function captureSystem(o: { points: Array<{ id: string; x: number; z: number; radius?: number; value?: number }>; rate?: number }): System;
export function reinforceSystem(o: { budget?: number; deployDelay?: number; refundDelay?: number; maxPerDrop?: number;
  zones: Array<{ team: number; x: number; z: number; radius?: number }>; start?: Array<{ p: number; kinds: string[] }> }): System;
export function baseSystem(o?: { startRes?: number; supplyCap?: number; buildRadius?: number; start?: Array<{ p: number; x: number; z: number; kinds: string[] }>;
  resources?: Array<{ kind: string; x: number; z: number }> }): System;
export function victorySystem(o?: { scoreLimit?: number; timeLimit?: number; annihilation?: boolean }): System;
export function botSystem(): System;

// ---- drivers, network, replays ----

/** What the engine's rts() module drives: single player, online lockstep and replays share it */
export interface Driver {
  sim: Sim; player: number; status: 'connecting' | 'lobby' | 'running' | 'waiting' | 'ended' | 'closed'; log: Array<{ turn: number; cmds: Command[] }>;
  readonly alpha: number;
  issue(cmd: Command): string;
  update(seconds: number): { ticks: number; events: SimEvent[] };
  describe(): Record<string, unknown>;
}
export const TURN_TICKS: 2;
export function checkShape(cmd: unknown): string;
export function localDriver(sim: Sim, o?: { player?: number; speed?: number }): Driver & { speed: number };

export interface Transport { send(obj: unknown): void; close(): void; onOpen: (() => void) | null; onMessage: ((m: any) => void) | null; onClose: (() => void) | null }
export interface LobbyMessage { type: 'lobby'; state: string; host: number; slots: Array<{ name: string; team: number; faction: string | null; ready: boolean; away: boolean }> }
export interface MatchSettings { seed: number; players: PlayerSetup[]; turnMs?: number; version?: string; contentHash?: number; mapHash?: number; [k: string]: unknown }
export interface LockstepDriver extends Driver {
  transport: Transport; key: string; lobby: LobbyMessage | null; settings: MatchSettings | null; desyncs: Array<{ turn: number; hashes: Record<number, number> }>;
  readonly buffer: number;
  on(type: 'welcome' | 'lobby' | 'start' | 'desync' | 'away' | 'back' | 'error' | 'close' | string, fn: (m: any) => void): { remove(): void };
  setSlot(s: { team?: number; faction?: string | null }): void;
  ready(r?: boolean): void;
  start(settings?: Record<string, unknown>): void;
  dump(turn: number): Snapshot | null;
  close(): void;
}
export function lockstepDriver(o: { transport: Transport; makeSim: (settings: MatchSettings) => Sim; room?: string; name?: string; version?: string;
  contentHash?: number; mapHash?: number; observer?: boolean; key?: string; buffer?: number; debugSnapshots?: boolean; now?: () => number }): LockstepDriver;
export function webSocketTransport(url: string): Transport;
export function memoryNetwork(o?: { latency?: number; jitter?: number; seed?: number; room?: Record<string, unknown> }): {
  room: RelayRoom; readonly now: number; connect(): Transport & { conn: unknown }; drop(t: Transport): void; advance(ms: number): void;
};
export class RelayRoom {
  constructor(name: string, o?: { now?: () => number; turnMs?: number; leaveAfterMs?: number; observerDelay?: number; maxPlayers?: number; seed?: () => number });
  state: 'lobby' | 'playing' | 'ended'; turn: number; desyncs: Array<{ turn: number; hashes: Record<number, number> }>; [k: string]: any;
  join(conn: { send(o: unknown): void; close(): void }, hello: unknown): string;
  message(conn: unknown, m: unknown): void;
  leave(conn: unknown): void;
  pump(): void;
  replay(): { settings: MatchSettings; turns: Array<[number, Command[]]>; lastTurn: number };
  describe(): Record<string, unknown>;
}
export interface Replay { v: 1; version: string; settings: MatchSettings; contentHash: number; mapHash: number; turns: Array<[number, Command[]]>; lastTurn: number; hashes: Array<[number, number]> }
export const REPLAY_VERSION: 1;
export function makeReplay(driver: Driver & { settings?: MatchSettings | null }, o?: { version?: string; settings?: MatchSettings; makeSim?: (s: MatchSettings) => Sim }): Replay;
export function verifyReplay(rep: Replay, makeSim: (s: MatchSettings) => Sim): { ok: boolean; turns: number; firstMismatch: null | { turn: number; want: number; got: number }; sim: Sim; why?: string };
export function replayDriver(sim: Sim, rep: Replay, o?: { speed?: number; makeSim?: (s: MatchSettings) => Sim }): Driver & { speed: number; paused: boolean; seek(turn: number): void };
export const PROTOCOL: 1, TURN_MS: 100, HASH_EVERY: 10, MAX_PLAYERS: 8;
