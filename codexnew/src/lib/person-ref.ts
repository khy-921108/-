import { normalizeKrPhone } from './phone';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * 작업허가 "우리 업체 수료자 불러오기"용 참여자 토큰. 서버 전용.
 * - ref: 이름·생년월일·연락처를 AES-256-GCM으로 암호화한 값. 브라우저는 내용을 볼 수 없다.
 *   참여자는 직접 입력(name,birthDate,phone) 또는 ref 어느 쪽이든 받는다.
 * - personId: 같은 사람인지 비교하는 값(HMAC). 되돌려 번호를 알아낼 수 없다.
 * - WP_PERSON_REF_SECRET 이 없으면 불러오기만 꺼지고 직접 입력은 그대로 동작한다.
 */

export interface PersonInput {
  name: string;
  birthDate: string;
  phone: string;
}

export interface RefPerson extends PersonInput {
  companyId: string | null;
}

export type RefErrorCode = 'REF_INVALID' | 'REF_EXPIRED' | 'REF_DISABLED';

const REF_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from('wp-person-ref-v1');

function secret(): string | null {
  const s = (process.env.WP_PERSON_REF_SECRET ?? '').trim();
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

/** 암호화와 사람 비교에 서로 다른 키를 쓴다. */
function subKey(master: string, label: 'enc' | 'id'): Buffer {
  return createHmac('sha256', master).update(`wp-person-ref:${label}`).digest();
}

function digits(s: unknown): string {
  return normalizeKrPhone((s ?? '').toString());
}

export function personKey(p: PersonInput): string {
  return `${(p.name ?? '').trim()}||${(p.birthDate ?? '').trim()}||${digits(p.phone)}`;
}

export function isPersonRefEnabled(): boolean {
  return secret() !== null;
}

/** 직접 입력과 불러오기 사이의 중복 판별값. 비밀키가 없으면 null. */
export function personIdOf(p: PersonInput): string | null {
  const master = secret();
  if (!master) return null;
  return createHmac('sha256', subKey(master, 'id')).update(personKey(p)).digest('base64url').slice(0, 32);
}

export function sealPersonRef(p: RefPerson, now = Date.now()): string | null {
  const master = secret();
  if (!master) return null;
  const payload = JSON.stringify({
    name: p.name,
    birthDate: p.birthDate,
    phone: digits(p.phone),
    companyId: p.companyId,
    exp: now + REF_TTL_MS,
  });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', subKey(master, 'enc'), iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function openPersonRef(
  ref: string,
  now = Date.now()
): { ok: true; person: RefPerson } | { ok: false; code: RefErrorCode } {
  const master = secret();
  if (!master) return { ok: false, code: 'REF_DISABLED' };
  try {
    const raw = Buffer.from(ref, 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) return { ok: false, code: 'REF_INVALID' };
    const decipher = createDecipheriv('aes-256-gcm', subKey(master, 'enc'), raw.subarray(0, IV_BYTES));
    decipher.setAAD(AAD);
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    const d = JSON.parse(text);
    if (typeof d.exp !== 'number' || typeof d.name !== 'string' || typeof d.birthDate !== 'string' || typeof d.phone !== 'string') {
      return { ok: false, code: 'REF_INVALID' };
    }
    if (d.exp <= now) return { ok: false, code: 'REF_EXPIRED' };
    return {
      ok: true,
      person: { name: d.name, birthDate: d.birthDate, phone: d.phone, companyId: d.companyId ?? null },
    };
  } catch {
    return { ok: false, code: 'REF_INVALID' };
  }
}

const REF_MESSAGES: Record<RefErrorCode, string> = {
  REF_INVALID: '불러온 참여자 정보를 확인할 수 없습니다. 참여자 단계에서 [우리 업체 수료자 불러오기]를 다시 눌러 주세요.',
  REF_EXPIRED: '불러온 참여자 정보의 유효시간이 지났습니다. 참여자 단계에서 [우리 업체 수료자 불러오기]를 다시 눌러 주세요.',
  REF_DISABLED: '지금은 불러온 참여자를 사용할 수 없습니다. 참여자 단계에서 직접 입력해 주세요.',
};

export type ResolveFail = { ok: false; code: RefErrorCode; message: string };

/** 참여자 1명 입력을 {name,birthDate,phone}으로 맞춘다. ref 가 있으면 ref 를 쓴다. */
export function resolvePersonInput(
  input: any
): { ok: true; person: PersonInput; fromRef: boolean } | ResolveFail {
  const ref = typeof input?.ref === 'string' ? input.ref.trim() : '';
  if (ref) {
    const opened = openPersonRef(ref);
    if (!opened.ok) return { ok: false, code: opened.code, message: REF_MESSAGES[opened.code] };
    const { name, birthDate, phone } = opened.person;
    return { ok: true, person: { name, birthDate, phone }, fromRef: true };
  }
  return {
    ok: true,
    person: {
      name: (input?.name ?? '').toString().trim(),
      birthDate: (input?.birthDate ?? '').toString().trim(),
      phone: digits(input?.phone),
    },
    fromRef: false,
  };
}

/** 여러 명. 순서는 입력 순서 그대로다. 하나라도 ref 가 잘못되면 전체를 거부한다. */
export function resolvePersonInputs(
  list: any[]
): { ok: true; persons: PersonInput[]; fromRef: boolean[] } | ResolveFail {
  const persons: PersonInput[] = [];
  const fromRef: boolean[] = [];
  for (const item of list) {
    const r = resolvePersonInput(item);
    if (!r.ok) return r;
    persons.push(r.person);
    fromRef.push(r.fromRef);
  }
  return { ok: true, persons, fromRef };
}
