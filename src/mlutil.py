"""scikit-learn 없이 쓰는 최소 구현 (이 PC의 Windows 애플리케이션 제어 정책이 sklearn DLL 로드를 차단함).

- L2 로지스틱 회귀: sklearn LogisticRegression(C) 과 같은 목적함수 0.5·||w||² + C·Σ logloss (절편은 규제 제외), L-BFGS
- 표준화, 층화·그룹 K-fold, precision/recall/F1/ROC-AUC/혼동행렬
"""
import numpy as np
import torch


def standardize(tr: np.ndarray, te: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mu, sd = tr.mean(0), tr.std(0)
    sd[sd == 0] = 1.0
    return (tr - mu) / sd, (te - mu) / sd


def fit_predict_logreg(Xtr, ytr, Xte, C: float = 0.1) -> np.ndarray:
    X = torch.tensor(Xtr, dtype=torch.float64)
    y = torch.tensor(ytr, dtype=torch.float64)
    w = torch.zeros(X.shape[1], dtype=torch.float64, requires_grad=True)
    b = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    opt = torch.optim.LBFGS([w, b], max_iter=1000, tolerance_grad=1e-8, tolerance_change=1e-12, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        loss = 0.5 * (w @ w) + C * torch.nn.functional.binary_cross_entropy_with_logits(X @ w + b, y, reduction="sum")
        loss.backward()
        return loss

    opt.step(closure)
    with torch.no_grad():
        return torch.sigmoid(torch.tensor(Xte, dtype=torch.float64) @ w + b).numpy()


def stratified_group_kfold(y: np.ndarray, groups: np.ndarray, k: int = 5, seed: int = 42):
    """같은 그룹은 같은 fold, fold별 클래스 수가 고르게 되도록 탐욕 배정. (train_idx, test_idx) 생성."""
    rng = np.random.default_rng(seed)
    ug, inv = np.unique(groups, return_inverse=True)
    cnt = np.zeros((len(ug), 2), dtype=int)
    np.add.at(cnt, (inv, y.astype(int)), 1)
    order = rng.permutation(len(ug))
    order = order[np.argsort(-cnt[order].sum(1), kind="stable")]  # 큰 그룹부터
    fold_cnt = np.zeros((k, 2), dtype=int)
    assign = np.empty(len(ug), dtype=int)
    for g in order:
        # 이 그룹의 다수 클래스가 가장 적은 fold, 동률이면 전체 수가 적은 fold
        f = int(np.lexsort((fold_cnt.sum(1), fold_cnt[:, cnt[g].argmax()]))[0])
        assign[g] = f
        fold_cnt[f] += cnt[g]
    fold = assign[inv]
    for f in range(k):
        yield np.where(fold != f)[0], np.where(fold == f)[0]


def roc_auc(y: np.ndarray, s: np.ndarray) -> float:
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s))
    ss = s[order]
    i = 0
    while i < len(ss):  # 동점은 평균 순위
        j = i
        while j + 1 < len(ss) and ss[j + 1] == ss[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    n1, n0 = int(y.sum()), int((1 - y).sum())
    return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def prf(y: np.ndarray, pred: np.ndarray) -> dict:
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return dict(precision=p, recall=r, f1=f, tn=tn, fp=fp, fn=fn, tp=tp)
