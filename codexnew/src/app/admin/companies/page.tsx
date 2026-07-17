'use client';

import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_STATUS,
  COMPANY_TYPES,
  companyStatusLabel,
  companyTypeLabel,
  companyFieldRules,
  approvalMissingFields,
  type CompanyStatus,
  type CompanyType,
} from '@/lib/company';
import { isValidBizNo, bizNoDigits } from '@/lib/bizno';
import BizNoField from '@/components/BizNoField';
import StatCardButton from '@/components/StatCardButton';
import {
  EQUIPMENT_TYPES,
  MEMBER_TYPES,
  equipmentTypeLabel,
  memberTypeLabel,
  type EquipmentType,
  type MemberType,
} from '@/lib/equipment';
import {
  DOC_CATEGORIES,
  MAX_DOC_BYTES,
  validateUpload,
  type DocCategoryKey,
} from '@/lib/company-documents';

interface CompanyItem {
  id: string;
  name: string;
  biz_no: string | null;
  company_type: CompanyType;
  manager_name: string | null;
  phone: string | null;
  address: string | null;
  tel: string | null;
  biz_status: string | null;
  biz_checked_at: string | null;
  status: CompanyStatus;
  created_by: 'APPLICANT' | 'ADMIN';
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  review: number;
  active: number;
  disabled: number;
}

interface MemberItem {
  id: string | null;
  member_type: MemberType | null;
  name: string;
  birth_date: string | null;
  phone: string | null;
  vehicle_number: string | null;
  equipment_type: EquipmentType | null;
  equipment_type_etc: string | null;
  spec: string | null;
  note: string | null;
  source: 'BOTH' | 'MASTER' | 'TRAINING';
  completion_status: 'VALID' | 'EXPIRING7' | 'EXPIRED' | 'NONE';
  completed_at: string | null;
  expires_at: string | null;
}

interface MemberStats {
  total: number;
  valid: number;
  expiring7: number;
  expired: number;
  none: number;
  vehicleCount: number;
  equipmentCount: number;
}

function statusBadge(status: CompanyStatus) {
  const map: Record<CompanyStatus, string> = {
    REVIEW: 'bg-amber-100 text-amber-700',
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    DISABLED: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${map[status]}`}>
      {companyStatusLabel(status)}
    </span>
  );
}

function completionBadge(status: MemberItem['completion_status']) {
  const map = {
    VALID: 'bg-emerald-100 text-emerald-700',
    EXPIRING7: 'bg-amber-100 text-amber-700',
    EXPIRED: 'bg-red-100 text-red-700',
    NONE: 'bg-red-100 text-red-700', // 미이수도 빨강(작업 전 필수)
  };
  const label = {
    VALID: '유효',
    EXPIRING7: '만료예정',
    EXPIRED: '만료',
    NONE: '미이수',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${map[status]}`}>
      {label[status]}
    </span>
  );
}

/** 출처 태그: 마스터(명단)·교육·둘다 */
function sourceTag(source: MemberItem['source']) {
  const map = {
    BOTH: { cls: 'bg-indigo-50 text-indigo-600', label: '명단+교육' },
    MASTER: { cls: 'bg-slate-100 text-slate-500', label: '명단만' },
    TRAINING: { cls: 'bg-sky-50 text-sky-600', label: '교육만' },
  };
  const m = map[source];
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}

export default function AdminCompaniesPage() {
  const [items, setItems] = useState<CompanyItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, review: 0, active: 0, disabled: 0 });
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState<'' | CompanyType>('');
  const [filterStatus, setFilterStatus] = useState<'' | CompanyStatus>('');
  const [editing, setEditing] = useState<CompanyItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingMembers, setViewingMembers] = useState<CompanyItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = async (opts?: { status?: '' | CompanyStatus; type?: '' | CompanyType; kw?: string }) => {
    setLoading(true);
    const st = opts?.status !== undefined ? opts.status : filterStatus;
    const ty = opts?.type !== undefined ? opts.type : filterType;
    const kw = opts?.kw !== undefined ? opts.kw : keyword;
    const params = new URLSearchParams();
    if (kw) params.set('keyword', kw);
    if (ty) params.set('type', ty);
    if (st) params.set('status', st);
    try {
      const res = await fetch(`/api/admin/companies?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setStats(json.data.stats);
      } else {
        alert(json.message || '조회 실패');
      }
    } finally {
      setLoading(false);
    }
  };

  // 숫자 카드 클릭 = 상태 필터 전환 + 구분·검색어 초기화(카드 숫자와 목록 일치 보장)
  const pickStatus = (st: '' | CompanyStatus) => {
    setFilterStatus(st);
    setFilterType('');
    setKeyword('');
    setPage(1);
    load({ status: st, type: '', kw: '' });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(null);
        setCreating(false);
        setViewingMembers(null);
        setImporting(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">업체 관리</h1>
        <div className="flex gap-3 text-sm font-bold">
          <button onClick={() => setImporting(true)} className="text-slate-600 hover:underline">
            ⬆ 엑셀 업로드
          </button>
          <a href="/api/admin/companies/export" className="text-slate-600 hover:underline">
            ⬇ 엑셀 다운로드
          </a>
          <button onClick={() => setCreating(true)} className="text-brand hover:underline">
            + 신규 업체
          </button>
        </div>
      </div>

      {/* ① 숫자 카드 (클릭 = 상태 필터) — 3화면 공통 구조 */}
      <div className="grid grid-cols-4 gap-2">
        <StatCardButton label="전체" value={stats.total} active={filterStatus === ''} onClick={() => pickStatus('')} />
        <StatCardButton label="검토중" value={stats.review} color="text-amber-700" active={filterStatus === 'REVIEW'} onClick={() => pickStatus('REVIEW')} />
        <StatCardButton label="정식등록" value={stats.active} color="text-emerald-700" active={filterStatus === 'ACTIVE'} onClick={() => pickStatus('ACTIVE')} />
        <StatCardButton label="사용중지" value={stats.disabled} color="text-slate-500" active={filterStatus === 'DISABLED'} onClick={() => pickStatus('DISABLED')} />
      </div>

      <div className="card space-y-3">
        {/* ② 필터 줄 — 구분만(명부 성격이라 시간 필터 없음) */}
        <select
          className="input-base"
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value as '' | CompanyType); setPage(1); }}
        >
          <option value="">구분: 전체</option>
          {COMPANY_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        {/* ③ 통합 검색 */}
        <div className="flex gap-2 items-stretch">
          <input
            className="input-base flex-1 min-w-0"
            placeholder="업체명·담당자·사업자번호 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
          />
          <button
            onClick={() => { setPage(1); load(); }}
            className="shrink-0 rounded-xl bg-brand text-white text-sm font-semibold px-5 whitespace-nowrap disabled:opacity-50"
            disabled={loading}
          >{loading ? '조회 중…' : '검색'}</button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}건 · 카드 클릭 시 수정, "인원" 클릭 시 소속 인원 보기</p>
        {items.slice((Math.min(page, Math.max(1, Math.ceil(items.length / PAGE_SIZE))) - 1) * PAGE_SIZE, Math.min(page, Math.max(1, Math.ceil(items.length / PAGE_SIZE))) * PAGE_SIZE).map((it) => {
          const rules = companyFieldRules(it.company_type);
          const missing = it.status !== 'DISABLED' ? approvalMissingFields(it) : [];
          const bizBroken = !!it.biz_no && !isValidBizNo(it.biz_no);
          return (
          <div key={it.id} className="card hover:shadow-md transition space-y-2">
            <div
              className="cursor-pointer space-y-1"
              onClick={() => setEditing(it)}
            >
              {/* 1줄: 업체명 + 상태 */}
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-slate-800">{it.name}</p>
                {statusBadge(it.status)}
              </div>

              {rules.isIndividual ? (
                /* 개인: 구분·연락처만 간결 */
                <p className="text-xs text-slate-500">{companyTypeLabel(it.company_type)}{it.phone ? ` · ${it.phone}` : ''}</p>
              ) : rules.approvalNeedsBiz ? (
                /* 일반·장비: 구분·사업자번호+국세청 / 주소 / 담당자 */
                <>
                  <p className="text-xs text-slate-500">
                    {companyTypeLabel(it.company_type)}
                    {it.biz_no ? ` · ${it.biz_no}` : ' · 사업자번호 미입력'}
                    {it.biz_status && (
                      <span className={`ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${it.biz_status === '계속사업자' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                        {it.biz_status}
                      </span>
                    )}
                  </p>
                  {it.address && <p className="text-xs text-slate-500 truncate">{it.address}</p>}
                  <p className="text-xs text-slate-600">
                    {it.manager_name || '담당자 미입력'} · {it.phone || '연락처 없음'}{it.tel ? ` · 대표 ${it.tel}` : ''}
                  </p>
                </>
              ) : (
                /* 운송·기타: 업체명·구분(+있으면 담당자) */
                <p className="text-xs text-slate-500">
                  {companyTypeLabel(it.company_type)}
                  {it.manager_name ? ` · ${it.manager_name}${it.phone ? ` (${it.phone})` : ''}` : ''}
                </p>
              )}

              {/* ⚠ 경고 */}
              {missing.length > 0 && (
                <p className="text-xs font-bold text-amber-700" title={`빠진 항목: ${missing.join(', ')}`}>
                  ⚠ 정보 미비 — 승인 불가 <span className="font-normal text-amber-600">({missing.join('·')})</span>
                </p>
              )}
              {bizBroken && (
                <p className="text-xs font-bold text-red-600">🔴 사업자번호 형식 오류 — 수정에서 고쳐주세요</p>
              )}

              {it.note && (
                <p className="text-xs text-slate-500 truncate">메모: {it.note}</p>
              )}
              <p className="text-[11px] text-slate-400">
                등록주체: {it.created_by === 'APPLICANT' ? '신청자' : '관리자'}
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingMembers(it);
                }}
                className="text-xs font-bold text-brand hover:underline"
              >
                👥 인원/현황 보기 →
              </button>
            </div>
          </div>
          );
        })}
        {items.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">조회 결과가 없습니다.</div>
        )}

        {/* 페이지네이션 (10개씩 — 3화면 공통) */}
        {items.length > PAGE_SIZE && (() => {
          const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
          const cur = Math.min(page, totalPages);
          return (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={cur <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">◀ 이전</button>
              <span className="text-sm font-semibold text-slate-700">{cur} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={cur >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">다음 ▶</button>
            </div>
          );
        })()}
      </div>

      {(editing || creating) && (
        <CompanyEditModal
          item={editing}
          mode={creating ? 'create' : 'edit'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={async () => {
            setEditing(null);
            setCreating(false);
            await load();
          }}
        />
      )}

      {viewingMembers && (
        <MembersModal
          company={viewingMembers}
          onClose={() => setViewingMembers(null)}
        />
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={async () => {
            setImporting(false);
            await load();
          }}
        />
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-3 text-center shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-extrabold ${color ?? 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function CompanyEditModal({
  item,
  mode,
  onClose,
  onSaved,
}: {
  item: CompanyItem | null;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [bizNo, setBizNo] = useState(item?.biz_no ?? '');
  const [companyType, setCompanyType] = useState<CompanyType>(item?.company_type ?? 'GENERAL');
  const [managerName, setManagerName] = useState(item?.manager_name ?? '');
  const [phone, setPhone] = useState(item?.phone ?? '');
  const [address, setAddress] = useState(item?.address ?? '');
  const [tel, setTel] = useState(item?.tel ?? '');
  const [status, setStatus] = useState<CompanyStatus>(item?.status ?? 'ACTIVE');
  const [note, setNote] = useState(item?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);
  const rules = companyFieldRules(companyType);

  const onSave = async () => {
    setErr('');
    if (!name.trim()) {
      setErr(rules.isIndividual ? '등록명(개인(이름))을 입력해 주세요.' : '업체명을 입력해 주세요.');
      return;
    }
    if (rules.managerRequired && (!managerName.trim() || !bizNoDigits(phone))) {
      setErr('일반·장비업체는 담당자명·연락처가 필수입니다.');
      return;
    }
    if (bizNo && bizNoDigits(bizNo).length === 10 && !isValidBizNo(bizNo)) {
      setErr('형식상 불가능한 사업자번호입니다.');
      return;
    }
    if (status === 'ACTIVE') {
      const missing = approvalMissingFields({ company_type: companyType, biz_no: bizNo, address, tel });
      if (missing.length > 0) {
        setErr(`정식등록에는 ${missing.join('·')}이(가) 필요합니다. 업체에 확인 후 입력하세요.`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        bizNo: rules.showBizFields ? bizNo : '',
        companyType,
        managerName: rules.showManager ? managerName : '',
        phone: rules.showManager || rules.isIndividual ? phone : '',
        address: rules.showBizFields && !rules.isIndividual ? address : '',
        tel: rules.showBizFields && !rules.isIndividual ? tel : '',
        status,
        note,
      };
      const url = mode === 'create' ? '/api/admin/companies' : `/api/admin/companies/${item!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.message || '저장 실패');
        return;
      }
      onSaved();
    } catch (e) {
      console.error(e);
      setErr('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">
            {mode === 'create' ? '신규 업체 추가' : '업체 수정'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* 구분 우선 — 선택에 따라 아래 칸이 바뀝니다 */}
          <div>
            <label className="label">업체 구분 *</label>
            <select
              className="input-base"
              value={companyType}
              onChange={(e) => { setCompanyType(e.target.value as CompanyType); setErr(''); }}
            >
              {COMPANY_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{rules.isIndividual ? '등록명 * (개인(이름) 형식)' : '업체명 *'}</label>
            <input className="input-base" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={rules.isIndividual ? '개인(홍길동)' : ''} />
          </div>
          {rules.showBizFields && (
            <BizNoField value={bizNo} onChange={setBizNo}
              label={rules.isIndividual ? '사업자번호 (개인사업자만 · 선택)' : '사업자번호 (정식등록 시 필수)'} />
          )}
          {rules.showBizFields && !rules.isIndividual && (
            <>
              <div>
                <label className="label">사업장 주소 (정식등록 시 필수)</label>
                <input className="input-base" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <label className="label">대표번호 (정식등록 시 필수)</label>
                <input type="tel" inputMode="numeric" className="input-base" value={tel}
                  onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, '').slice(0, 12))} placeholder="0522345678" />
              </div>
            </>
          )}
          {rules.showManager && (
            <>
              <div>
                <label className="label">담당자명{rules.managerRequired ? ' *' : ''}</label>
                <input
                  className="input-base"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                />
              </div>
              <div>
                <label className="label">담당자 연락처{rules.managerRequired ? ' *' : ''}</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  className="input-base"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  placeholder="01012345678"
                />
              </div>
            </>
          )}
          {rules.isIndividual && (
            <div>
              <label className="label">연락처 (본인)</label>
              <input type="tel" inputMode="numeric" className="input-base" value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="01012345678" />
            </div>
          )}
          <div>
            <label className="label">상태</label>
            <select
              className="input-base"
              value={status}
              onChange={(e) => setStatus(e.target.value as CompanyStatus)}
            >
              {COMPANY_STATUS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">비고</label>
            <textarea
              className="input-base min-h-[80px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {err && (
            <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            취소
          </button>
          <button onClick={onSave} disabled={saving} className="btn-primary flex-1">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MembersModal({
  company,
  onClose,
}: {
  company: CompanyItem;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MemberItem[]>([]);
  const [stats, setStats] = useState<MemberStats>({
    total: 0,
    valid: 0,
    expiring7: 0,
    expired: 0,
    none: 0,
    vehicleCount: 0,
    equipmentCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/members`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setStats(json.data.stats);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id]);

  const removeMember = async (memberId: string, name: string) => {
    if (!confirm(`"${name}" 님을 이 업체 명단에서 삭제할까요?\n(교육 수료 기록은 그대로 유지됩니다)`)) return;
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/members/${memberId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        alert(json.message || '삭제 실패');
        return;
      }
      await load();
    } catch {
      alert('삭제 중 오류');
    }
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-4 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{company.name} · 인원현황</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {companyTypeLabel(company.company_type)} · {companyStatusLabel(company.status)} · 총 {stats.total}명
              <span className="text-slate-400"> (명단 ∪ 교육 통합)</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* 교육상태 카운트 */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="유효" value={stats.valid} color="text-emerald-700" />
            <StatCard label="만료예정" value={stats.expiring7} color="text-amber-700" />
            <StatCard label="만료" value={stats.expired} color="text-red-600" />
            <StatCard label="미이수" value={stats.none} color="text-red-600" />
          </div>

          {/* 엑셀 다운로드 / 업로드 */}
          <div className="flex gap-2">
            <a
              href={`/api/admin/companies/${company.id}/export`}
              className="btn-secondary flex-1 text-center text-sm"
            >
              📥 엑셀 다운로드
            </a>
            <button
              onClick={() => setShowImport((v) => !v)}
              className="btn-secondary flex-1 text-sm"
            >
              📤 엑셀 업로드
            </button>
          </div>

          {/* 인원 직접 추가 */}
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="btn-secondary w-full text-sm"
          >
            ➕ 인원 추가 (엑셀 없이)
          </button>

          {showImport && (
            <CompanyMemberImport
              companyId={company.id}
              onImported={async () => {
                await load();
              }}
            />
          )}

          {showAdd && (
            <MemberAddForm
              companyId={company.id}
              onAdded={async () => {
                setShowAdd(false);
                await load();
              }}
            />
          )}

          {loading ? (
            <p className="text-center text-slate-500 py-6">조회 중...</p>
          ) : items.length === 0 ? (
            <div className="card text-center text-slate-500 py-8">
              소속 인원이 없습니다.<br />
              <span className="text-xs">이 업체로 교육 수료자나 명단(엑셀)이 등록되면 표시됩니다.</span>
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((m, idx) => (
                <li key={m.id ?? `t-${idx}`} className="rounded-xl border border-slate-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">
                        {m.name}{' '}
                        <span className="text-xs font-normal text-slate-500">
                          ({m.member_type ? memberTypeLabel(m.member_type) : '작업자'})
                        </span>{' '}
                        {sourceTag(m.source)}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {m.birth_date || '생년월일 미입력'} · {m.phone || '연락처 미입력'}
                      </p>
                      {(m.vehicle_number || m.equipment_type || m.spec) && (
                        <p className="text-xs text-slate-600 mt-0.5">
                          {m.vehicle_number ? `🚗 ${m.vehicle_number}` : ''}
                          {m.equipment_type
                            ? ` · ${equipmentTypeLabel(m.equipment_type)}${m.equipment_type === 'ETC' && m.equipment_type_etc ? `(${m.equipment_type_etc})` : ''}`
                            : ''}
                          {m.spec ? ` · ${m.spec}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      {completionBadge(m.completion_status)}
                      {m.expires_at && (
                        <p className="text-[10px] text-slate-400">
                          ~{m.expires_at.substring(0, 10)}
                        </p>
                      )}
                      {m.id && (
                        <button
                          onClick={() => removeMember(m.id!, m.name)}
                          className="block ml-auto text-[11px] font-bold text-red-600 hover:underline"
                          title="명단에서 삭제(교육기록은 유지)"
                        >
                          🗑 삭제
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* 📁 문서함 */}
          <DocumentsSection companyId={company.id} />
        </div>

        <div className="border-t border-slate-200 p-4">
          <button onClick={onClose} className="btn-secondary w-full">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 어드민 인원 직접 추가 폼 (엑셀 없이 한 명). */
function MemberAddForm({
  companyId,
  onAdded,
}: {
  companyId: string;
  onAdded: () => void;
}) {
  const [memberType, setMemberType] = useState<MemberType>('WORKER');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [equipmentType, setEquipmentType] = useState<'' | EquipmentType>('');
  const [equipmentTypeEtc, setEquipmentTypeEtc] = useState('');
  const [spec, setSpec] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);
  const showVehicle = memberType === 'TRUCK' || memberType === 'HEAVY';

  const submit = async () => {
    setErr('');
    setMsg('');
    if (!name.trim()) {
      setErr('이름을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/members/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          birthDate: birthDate || undefined,
          phone: phone || undefined,
          memberType,
          vehicleNumber: vehicleNumber || undefined,
          equipmentType: equipmentType || undefined,
          equipmentTypeEtc: equipmentTypeEtc || undefined,
          spec: spec || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.message || '추가 실패');
        return;
      }
      if (json.data?.added) {
        onAdded(); // 추가됨 → 폼 닫고 목록 갱신
      } else {
        setMsg(json.message || '이미 명단에 있는 인원입니다.');
      }
    } catch {
      setErr('네트워크 오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs font-bold text-slate-700">➕ 인원 직접 추가</p>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="input-base text-sm"
          value={memberType}
          onChange={(e) => setMemberType(e.target.value as MemberType)}
        >
          {MEMBER_TYPES.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
        <input
          className="input-base text-sm"
          placeholder="이름 *"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="date"
          className="input-base text-sm"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          aria-label="생년월일"
        />
        <input
          type="tel"
          inputMode="numeric"
          className="input-base text-sm"
          placeholder="연락처(숫자만)"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
        />
      </div>

      {showVehicle && (
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input-base text-sm"
            placeholder="차량번호"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
          />
          <input
            className="input-base text-sm"
            placeholder="톤수/규격(예: 5톤)"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
        </div>
      )}
      {memberType === 'HEAVY' && (
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-base text-sm"
            value={equipmentType}
            onChange={(e) => setEquipmentType(e.target.value as '' | EquipmentType)}
          >
            <option value="">장비종류 선택</option>
            {EQUIPMENT_TYPES.map((eq) => (
              <option key={eq.code} value={eq.code}>{eq.label}</option>
            ))}
          </select>
          {equipmentType === 'ETC' && (
            <input
              className="input-base text-sm"
              placeholder="기타 장비명"
              value={equipmentTypeEtc}
              onChange={(e) => setEquipmentTypeEtc(e.target.value)}
            />
          )}
        </div>
      )}

      {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
      {msg && <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">{msg}</div>}
      <button onClick={submit} disabled={busy || !name.trim()} className="btn-primary text-sm w-full">
        {busy ? '추가 중...' : '명단에 추가'}
      </button>
    </div>
  );
}

interface DocItem {
  id: string;
  category: string;
  categoryLabel: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  note: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDateTimeKST(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/** signed upload URL 로 직접 PUT(진행률 XHR). storage-js 와 동일한 multipart 형식. */
function putToSignedUrl(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('x-upsert', 'false'); // storage-js SDK 와 동일(신규 업로드)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('네트워크 오류'));
    xhr.send(form);
  });
}

/** 업체 상세 내 문서함: 카테고리 업로드(진행률) + 목록 + 다운로드 + 삭제 + 필터. */
function DocumentsSection({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'' | DocCategoryKey>('');
  const [upCategory, setUpCategory] = useState<DocCategoryKey>('roster');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const qs = filter ? `?category=${filter}` : '';
      const res = await fetch(`/api/admin/companies/${companyId}/documents${qs}`);
      const json = await res.json();
      if (json.success) setItems(json.data.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filter]);

  const upload = async () => {
    setErr('');
    if (!file) {
      setErr('파일을 선택해 주세요.');
      return;
    }
    // 1차 클라 검증(서버가 최종 검증)
    const v = validateUpload({ fileName: file.name, sizeBytes: file.size, mimeType: file.type });
    if (!v.ok) {
      setErr(v.message);
      return;
    }
    setBusy(true);
    setPct(0);
    try {
      // 1) signed upload URL
      const r1 = await fetch(`/api/admin/companies/${companyId}/documents/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, category: upCategory, sizeBytes: file.size, mimeType: file.type }),
      });
      const j1 = await r1.json();
      if (!j1.success) {
        setErr(j1.message || '업로드 URL 발급 실패');
        return;
      }
      // 2) Storage 직접 PUT(진행률)
      await putToSignedUrl(j1.data.signedUrl, file, setPct);
      // 3) 메타 기록
      const r2 = await fetch(`/api/admin/companies/${companyId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: upCategory,
          fileName: file.name,
          storagePath: j1.data.path,
          mimeType: file.type,
          sizeBytes: file.size,
          note: note.trim() || undefined,
        }),
      });
      const j2 = await r2.json();
      if (!j2.success) {
        setErr(j2.message || '문서 정보 저장 실패(업로드는 됨)');
        return;
      }
      // 초기화 + 새로고침
      setFile(null);
      setNote('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || '업로드 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
      setPct(null);
    }
  };

  const download = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/documents/${id}/download`);
      const json = await res.json();
      if (!json.success) {
        alert(json.message || '다운로드 실패');
        return;
      }
      window.location.href = json.data.url;
    } catch {
      alert('다운로드 중 오류');
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`"${name}" 문서를 삭제할까요? (되돌릴 수 없습니다)`)) return;
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/documents/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        alert(json.message || '삭제 실패');
        return;
      }
      await load();
    } catch {
      alert('삭제 중 오류');
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
      <h3 className="text-sm font-bold text-slate-700">📁 문서함</h3>

      {/* 업로드 */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-base text-sm"
            value={upCategory}
            onChange={(e) => setUpCategory(e.target.value as DocCategoryKey)}
          >
            {DOC_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx,.hwp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setErr('');
            }}
            className="text-xs"
          />
        </div>
        <input
          className="input-base text-sm"
          placeholder="메모(선택)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="text-[11px] text-slate-400">
          허용: pdf·jpg·png·xlsx·docx·hwp / 최대 {Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB
        </p>
        {busy && pct !== null && (
          <div className="h-2 w-full rounded bg-slate-200 overflow-hidden">
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
        <button onClick={upload} disabled={busy || !file} className="btn-primary text-sm w-full">
          {busy ? `업로드 중... ${pct ?? 0}%` : '⬆ 업로드'}
        </button>
      </div>

      {/* 목록 필터 */}
      <div className="flex items-center gap-2">
        <select
          className="input-base text-xs flex-1"
          value={filter}
          onChange={(e) => setFilter(e.target.value as '' | DocCategoryKey)}
        >
          <option value="">전체 분류</option>
          {DOC_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <span className="text-[11px] text-slate-400 shrink-0">{items.length}건</span>
      </div>

      {/* 목록 */}
      {loading ? (
        <p className="text-center text-slate-500 py-3 text-xs">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-center text-slate-400 py-4 text-xs">등록된 문서가 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-100 p-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{d.fileName}</p>
                <p className="text-[11px] text-slate-500">
                  {d.categoryLabel} · {fmtBytes(d.sizeBytes)} · {fmtDateTimeKST(d.createdAt)}
                  {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
                </p>
                {d.note && <p className="text-[11px] text-slate-400 truncate">메모: {d.note}</p>}
              </div>
              <div className="shrink-0 flex gap-2">
                <button onClick={() => download(d.id)} className="text-xs font-bold text-brand hover:underline">
                  📥
                </button>
                <button onClick={() => remove(d.id, d.fileName)} className="text-xs font-bold text-red-600 hover:underline">
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface MemberImportResp {
  success: boolean;
  code?: string;
  message?: string;
  data?: {
    dryRun: boolean;
    members: { count: number; rows: any[] } | { inserted: number; updated: number };
    errors: { sheet: string; rowIndex: number; field?: string; message: string }[];
    warnings: { sheet: string; rowIndex: number; message: string }[];
  };
}

/** 업체 상세 내 인원 엑셀 업로드 (미리보기 → 오류확인 → 반영). 이 업체에만 반영. */
function CompanyMemberImport({
  companyId,
  onImported,
}: {
  companyId: string;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MemberImportResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [err, setErr] = useState('');

  const post = async (dryRun: boolean) => {
    if (!file) {
      setErr('파일을 선택해 주세요.');
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/admin/companies/${companyId}/members/import${dryRun ? '?dryRun=1' : ''}`,
        { method: 'POST', body: fd }
      );
      const json: MemberImportResp = await res.json();
      setPreview(json);
      if (!dryRun && json.success) {
        setCommitted(true);
        onImported();
      } else if (!json.success && json.message) {
        setErr(json.message);
      }
    } catch (e) {
      console.error(e);
      setErr('네트워크 오류');
    } finally {
      setLoading(false);
    }
  };

  const hasErrors = !!preview?.data?.errors?.length;
  const previewReady = !!preview && !committed && preview.data?.dryRun;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
      <p className="text-slate-500">
        "엑셀 다운로드"로 받은 파일의 <b>인원</b> 시트를 수정해 업로드하세요. 이 업체 명단에만 반영됩니다.
        (교육수료일·유효기간·상태 컬럼은 자동계산이라 무시됩니다.)
      </p>
      <input
        type="file"
        accept=".xlsx"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
          setCommitted(false);
          setErr('');
        }}
        className="w-full text-xs"
      />
      <div className="flex gap-2">
        <button onClick={() => post(true)} disabled={loading || !file} className="btn-secondary flex-1 text-xs">
          {loading && !committed ? '검증 중...' : '🔍 검증(미리보기)'}
        </button>
        <button
          onClick={() => post(false)}
          disabled={loading || !previewReady || hasErrors}
          className="btn-primary flex-1 text-xs"
        >
          {committed ? '✅ 반영 완료' : '⬆ 반영'}
        </button>
      </div>

      {err && <div className="rounded bg-red-50 p-2 text-red-700">{err}</div>}

      {preview?.data && (
        <div className="rounded border border-slate-200 bg-white p-2 space-y-1">
          {preview.data.dryRun ? (
            <p className="text-slate-700">검증 대상 인원 {(preview.data.members as any).count}명</p>
          ) : (
            <p className="text-slate-700">
              반영 — 신규 {(preview.data.members as any).inserted ?? 0} / 업데이트{' '}
              {(preview.data.members as any).updated ?? 0}
            </p>
          )}
          {preview.data.errors.length > 0 && (
            <details open>
              <summary className="font-bold text-red-700 cursor-pointer">오류 {preview.data.errors.length}건</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.data.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="text-red-700">
                    [{e.rowIndex}행{e.field ? ` · ${e.field}` : ''}] {e.message}
                  </li>
                ))}
                {preview.data.errors.length > 20 && (
                  <li className="text-slate-500">... 외 {preview.data.errors.length - 20}건</li>
                )}
              </ul>
            </details>
          )}
          {preview.data.warnings.length > 0 && (
            <details>
              <summary className="font-bold text-amber-700 cursor-pointer">경고 {preview.data.warnings.length}건</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.data.warnings.slice(0, 20).map((w, i) => (
                  <li key={i} className="text-amber-700">[{w.rowIndex}행] {w.message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

interface ImportPreviewResp {
  success: boolean;
  code?: string;
  message?: string;
  data?: {
    dryRun: boolean;
    companies: { count: number; rows: any[] } | { inserted: number; updated: number };
    members:
      | { count: number; rows: any[] }
      | { inserted: number; updated: number; skipped: number };
    errors: { sheet: string; rowIndex: number; field?: string; message: string }[];
    warnings: { sheet: string; rowIndex: number; message: string }[];
  };
}

function ImportModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [err, setErr] = useState('');

  const doDryRun = async () => {
    if (!file) {
      setErr('파일을 선택해 주세요.');
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/companies/import?dryRun=1', {
        method: 'POST',
        body: fd,
      });
      const json: ImportPreviewResp = await res.json();
      setPreview(json);
      if (!json.success && json.message) setErr(json.message);
    } catch (e) {
      console.error(e);
      setErr('네트워크 오류');
    } finally {
      setLoading(false);
    }
  };

  const doCommit = async () => {
    if (!file) return;
    setErr('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/companies/import', {
        method: 'POST',
        body: fd,
      });
      const json: ImportPreviewResp = await res.json();
      setPreview(json);
      if (json.success) {
        setCommitted(true);
      } else if (json.message) {
        setErr(json.message);
      }
    } catch (e) {
      console.error(e);
      setErr('네트워크 오류');
    } finally {
      setLoading(false);
    }
  };

  const hasErrors = !!preview?.data?.errors?.length;
  const fatalErrors = !!preview?.data?.errors?.some((e) => e.rowIndex <= 1); // 시트/헤더(양식) 오류 → 반영 불가
  const previewReady = !!preview && !committed;

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">엑셀 업로드 (업체 + 인원)</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">
            먼저 "엑셀 다운로드" 로 받은 양식에 맞춰 작성한 후 업로드 → 검증 결과를 확인하고 반영하세요.
          </p>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(null);
                setCommitted(false);
              }}
              className="w-full text-sm"
            />
            {file && (
              <p className="text-xs text-slate-500 mt-1">선택됨: {file.name}</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={doDryRun}
              disabled={loading || !file}
              className="btn-secondary flex-1"
            >
              {loading && !committed ? '검증 중...' : '🔍 검증 (미리보기)'}
            </button>
            <button
              onClick={doCommit}
              disabled={loading || !previewReady || fatalErrors}
              className="btn-primary flex-1"
            >
              {committed ? '✅ 반영 완료' : hasErrors ? '⬆ 오류 행 제외하고 반영' : '⬆ DB 반영'}
            </button>
          </div>
          {hasErrors && !fatalErrors && !committed && (
            <p className="text-[11px] text-amber-700">⚠ 오류 행은 반영되지 않습니다. 아래 "몇 행: 사유" 목록을 확인해 수정 후 다시 올리거나, 나머지만 반영하세요.</p>
          )}

          {err && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}

          {preview?.data && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
              <p className="font-bold text-slate-800">
                {preview.data.dryRun ? '미리보기 결과' : '반영 결과'}
              </p>
              {preview.data.dryRun ? (
                <div className="space-y-1 text-slate-700">
                  <p>업체 시트: {(preview.data.companies as any).count}건</p>
                  <p>인원 시트: {(preview.data.members as any).count}건</p>
                </div>
              ) : (
                <div className="space-y-1 text-slate-700">
                  <p>
                    업체 — 신규 {(preview.data.companies as any).inserted ?? 0} /
                    업데이트 {(preview.data.companies as any).updated ?? 0}
                  </p>
                  <p>
                    인원 — 신규 {(preview.data.members as any).inserted ?? 0} /
                    업데이트 {(preview.data.members as any).updated ?? 0} /
                    건너뜀 {(preview.data.members as any).skipped ?? 0}
                  </p>
                </div>
              )}

              {preview.data.errors.length > 0 && (
                <details open>
                  <summary className="font-bold text-red-700 cursor-pointer">
                    오류 ({preview.data.errors.length}건)
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {preview.data.errors.slice(0, 30).map((e, i) => (
                      <li key={i} className="text-red-700">
                        [{e.sheet} {e.rowIndex}행{e.field ? ` · ${e.field}` : ''}] {e.message}
                      </li>
                    ))}
                    {preview.data.errors.length > 30 && (
                      <li className="text-slate-500">... 그리고 {preview.data.errors.length - 30}건 더</li>
                    )}
                  </ul>
                </details>
              )}

              {preview.data.warnings.length > 0 && (
                <details>
                  <summary className="font-bold text-amber-700 cursor-pointer">
                    경고 ({preview.data.warnings.length}건)
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {preview.data.warnings.slice(0, 30).map((w, i) => (
                      <li key={i} className="text-amber-700">
                        [{w.sheet} {w.rowIndex}행] {w.message}
                      </li>
                    ))}
                    {preview.data.warnings.length > 30 && (
                      <li className="text-slate-500">... 그리고 {preview.data.warnings.length - 30}건 더</li>
                    )}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            {committed ? '닫기' : '취소'}
          </button>
          {committed && (
            <button onClick={onDone} className="btn-primary flex-1">
              목록 새로고침
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
