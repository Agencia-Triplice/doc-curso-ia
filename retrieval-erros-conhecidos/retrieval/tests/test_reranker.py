"""Testes puros do reranker (sem rede, sem DB). Rode de dentro de retrieval/:
    python -m pytest tests/test_reranker.py
"""
import config
import reranker


def test_align_scores_reordena_para_ordem_de_entrada():
    results = [{"index": 2, "relevance_score": 0.9},
               {"index": 0, "relevance_score": 0.4},
               {"index": 1, "relevance_score": 0.7}]
    assert reranker._align_scores(results, 3) == [0.4, 0.7, 0.9]


def test_align_scores_preenche_ausentes_com_zero():
    assert reranker._align_scores([{"index": 1, "relevance_score": 0.5}], 3) == [0.0, 0.5, 0.0]


def test_align_scores_ignora_indice_fora_do_range():
    assert reranker._align_scores([{"index": 9, "relevance_score": 1.0}], 2) == [0.0, 0.0]


def test_rerank_desligado_retorna_none(monkeypatch):
    monkeypatch.setattr(config, "RERANKER_ENABLED", False)
    assert reranker.rerank("q", ["a", "b"]) is None


def test_rerank_lista_vazia_retorna_none(monkeypatch):
    monkeypatch.setattr(config, "RERANKER_ENABLED", True)
    assert reranker.rerank("q", []) is None
