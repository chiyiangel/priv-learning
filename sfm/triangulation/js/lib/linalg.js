// 小型线性代数库（无依赖）。3×3 矩阵用长度 9 的行主序数组，向量用长度 3 的数组。
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

export const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}
export const mulv3 = (A, v) => [
  A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
  A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
  A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
export const T3 = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export const det3 = (A) => A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
export const skew = (t) => [0, -t[2], t[1], t[2], 0, -t[0], -t[1], t[0], 0];
export const scale3 = (A, s) => A.map((x) => x * s);
export const sub3 = (A, B) => A.map((x, i) => x - B[i]);
export const add3 = (A, B) => A.map((x, i) => x + B[i]);
export const fro = (A) => Math.sqrt(A.reduce((s, x) => s + x * x, 0));
export function inv3(A) {
  const d = det3(A);
  const c = [
    A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4],
    A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5],
    A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3]];
  return c.map((x) => x / d);
}

/** 罗德里格斯公式：旋转向量 w → 旋转矩阵 */
export function expSO3(w) {
  const th = norm(w);
  if (th < 1e-12) return add3(I3(), skew(w));
  const K = skew(scale(w, 1 / th));
  const s = Math.sin(th), c = 1 - Math.cos(th);
  const K2 = mul3(K, K);
  return add3(add3(I3(), scale3(K, s)), scale3(K2, c));
}
/** 旋转矩阵 → 旋转角（弧度） */
export function rotAngle(R) {
  const c = Math.min(1, Math.max(-1, (R[0] + R[4] + R[8] - 1) / 2));
  return Math.acos(c);
}
export function angleBetween(a, b) {
  const c = dot(a, b) / (norm(a) * norm(b));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

// ---------- 通用矩阵（行数组）----------
/** 对称矩阵特征分解（Jacobi）。返回按特征值升序的 {values, vectors}，vectors[i] 为第 i 个特征向量 */
export function symEig(A0) {
  const n = A0.length;
  const A = A0.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(1 + th * th));
      const c = 1 / Math.sqrt(1 + t * t), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a][a] - A[b][b]);
  return { values: idx.map((i) => A[i][i]), vectors: idx.map((i) => V.map((r) => r[i])) };
}

/** 单边 Jacobi SVD。A: m×n（行数组）。m<n 时补零行。返回 {U(m×n), S(降序), V(n×n)}，A = U diag(S) Vᵀ */
export function svd(A0) {
  let m = A0.length; const n = A0[0].length;
  const U = A0.map((r) => r.slice());
  while (U.length < n) U.push(new Array(n).fill(0));
  m = U.length;
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      let al = 0, be = 0, ga = 0;
      for (let i = 0; i < m; i++) { al += U[i][p] * U[i][p]; be += U[i][q] * U[i][q]; ga += U[i][p] * U[i][q]; }
      if (Math.abs(ga) <= 1e-15 * Math.sqrt(al * be) || Math.abs(ga) < 1e-300) continue;
      rotated = true;
      const ze = (be - al) / (2 * ga);
      const t = Math.sign(ze || 1) / (Math.abs(ze) + Math.sqrt(1 + ze * ze));
      const c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let i = 0; i < m; i++) { const a = U[i][p], b = U[i][q]; U[i][p] = c * a - s * b; U[i][q] = s * a + c * b; }
      for (let i = 0; i < n; i++) { const a = V[i][p], b = V[i][q]; V[i][p] = c * a - s * b; V[i][q] = s * a + c * b; }
    }
    if (!rotated) break;
  }
  const S = new Array(n);
  for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += U[i][j] * U[i][j]; S[j] = Math.sqrt(s); }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => S[b] - S[a]);
  const Uo = U.map((r) => idx.map((j) => (S[j] > 1e-300 ? r[j] / S[j] : 0)));
  const Vo = V.map((r) => idx.map((j) => r[j]));
  return { U: Uo, S: idx.map((j) => S[j]), V: Vo };
}
/** 返回 A 的最小右奇异向量（A x = 0 的最小二乘解，‖x‖=1），以及全部奇异值 */
export function nullVector(A) {
  const { S, V } = svd(A);
  const n = V.length;
  return { x: V.map((r) => r[n - 1]), S };
}

/** 3×3 SVD（行主序数组）。返回 U,S,V 均为 3×3 行主序，且 det(U)=det(V)=+1 （第三列由前两列叉乘补全，S 允许最后一个值接近 0） */
export function svd3(M) {
  const rows = [[M[0], M[1], M[2]], [M[3], M[4], M[5]], [M[6], M[7], M[8]]];
  const { U, S, V } = svd(rows);
  const col = (X, j) => [X[0][j], X[1][j], X[2][j]];
  const u0 = col(U, 0), u1 = col(U, 1), v0 = col(V, 0), v1 = col(V, 1);
  let u2 = cross(u0, u1), v2 = cross(v0, v1);
  // 检查：最后一个奇异值对应的符号——对 det(M)<0 的情形，把符号放进 S[2]
  const Sg = S.slice();
  const dU = dot(u2, col(U, 2)), dV = dot(v2, col(V, 2));
  if (Sg[2] > 1e-12 * Sg[0]) { if (dU * dV < 0) Sg[2] = -Sg[2]; }
  const mk = (a, b, c) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
  return { U: mk(u0, u1, u2), S: Sg, V: mk(v0, v1, v2) };
}

/** 解线性方程组 A x = b（高斯消元，部分选主元）。A: n×n 行数组 */
export function solveLinear(A0, b0) {
  const n = b0.length;
  const A = A0.map((r, i) => [...r, b0[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-300;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / (A[r][r] || 1e-300);
  }
  return x;
}
export function inv3x3rows(M) { // 3×3 逆（行数组），用于 Schur 中的点块
  const f = [M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]];
  const g = inv3(f);
  return [[g[0], g[1], g[2]], [g[3], g[4], g[5]], [g[6], g[7], g[8]]];
}

// ---------- 随机数 ----------
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = () => next();
  r.gauss = () => { let u = 0; while (u === 0) u = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()); };
  r.int = (n) => Math.floor(next() * n);
  return r;
}
