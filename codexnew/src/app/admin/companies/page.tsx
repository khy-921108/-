'use client';

import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_STATUS,
  COMPANY_TYPES,
  companyStatusLabel,
  companyTypeLabel,
  type CompanyStatus,
  type CompanyType,
} from '@/lib/company';
import {
  equipmentTypeLabel,
  memberTypeLabel,
  type EquipmentType,
  type MemberType,
} from '@/lib/equipment';

interface CompanyItem {
  id: string;
  name: string;
  biz_no: string | null;
  company_type: CompanyType;
  manager_name: string | null;
  phone: string | null;
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

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div className="grid grid-cols-4 gap-2">
        <StatCard label="전체" value={stats.total} />
        <StatCard label="검토중" value={stats.review} color="text-amber-700" />
        <StatCard label="정식등록" value={stats.active} color="text-emerald-700" />
        <StatCard label="사용중지" value={stats.disabled} color="text-slate-500" />
      </div>

      <div className="card space-y-3">
        <input
          className="input-base"
          placeholder="업체명 또는 담당자 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-base"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as '' | CompanyType)}
          >
            <option value="">구분: 전체</option>
            {COMPANY_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            className="input-base"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | CompanyStatus)}
          >
            <option value="">상태: 전체</option>
            {COMPANY_STATUS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button onClick={load} className="btn-primary">
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}건 · 카드 클릭 시 수정, "인원" 클릭 시 소속 인원 보기</p>
        {items.map((it) => (
          <div key={it.id} className="card hover:shadow-md transition space-y-2">
            <div
              className="cursor-pointer space-y-2"
              onClick={() => setEditing(it)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-slate-800">{it.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {companyTypeLabel(it.company_type)}
                    {it.biz_no ? ` · 사업자 ${it.biz_no}` : ''}
                  </p>
                  {(it.manager_name || it.phone) && (
                    <p className="text-xs text-slate-600 mt-0.5">
                      {it.manager_name || '담당자 미입력'} · {it.phone || '연락처 없음'}
                    </p>
                  )}
                </div>
                {statusBadge(it.status)}
              </div>
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
        ))}
        {items.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">조회 결과가 없습니다.</div>
        )}
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
  const [status, setStatus] = useState<CompanyStatus>(item?.status ?? 'ACTIVE');
  const [note, setNote] = useState(item?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const onSave = async () => {
    setErr('');
    if (!name.trim()) {
      setErr('업체명을 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        bizNo,
        companyType,
        managerName,
        phone,
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
          <div>
            <label className="label">업체명 *</label>
            <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">사업자번호</label>
            <input
              className="input-base"
              value={bizNo}
              onChange={(e) => setBizNo(e.target.value)}
              placeholder="000-00-00000"
            />
          </div>
          <div>
            <label className="label">업체 구분</label>
            <select
              className="input-base"
              value={companyType}
              onChange={(e) => setCompanyType(e.target.value as CompanyType)}
            >
              {COMPANY_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">담당자명</label>
            <input
              className="input-base"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">담당자 연락처</label>
            <input
              type="tel"
              inputMode="numeric"
              className="input-base"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="01012345678"
            />
          </div>
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

          {showImport && (
            <CompanyMemberImport
              companyId={company.id}
              onImported={async () => {
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
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
              disabled={loading || !previewReady || hasErrors}
              className="btn-primary flex-1"
            >
              {committed ? '✅ 반영 완료' : '⬆ DB 반영'}
            </button>
          </div>

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
