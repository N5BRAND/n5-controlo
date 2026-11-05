"""Exporta os ecrãs da app para uma demonstração estática no GitHub Pages (pasta demo/).

Os dashboards ficam visíveis com os dados de exemplo; formulários, filtros e botões não funcionam
numa página estática. Para a app completa usa o Render (render.yaml) ou a AWS (docs/deploy-aws.md).

Uso (com Postgres local e o seed corrido):
  NEXT_BASE_PATH=/n5-controlo/demo npm run build
  NEXT_BASE_PATH=/n5-controlo/demo npx next start -p 3200 &
  python3 scripts/export-demo.py http://localhost:3200
"""
import os
import re
import shutil
import sys
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

BASE = "/n5-controlo/demo"
ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3200"
OUT = os.path.join(os.path.dirname(__file__), "..", "demo")

PAGES = [
    "", "comunidades", "comunidades?vista=membros", "comunidades?vista=changelog", "comunidades?vista=novo",
    "pipeline", "pipeline?vista=backlog", "pipeline?vista=entregas", "pipeline?vista=agentes", "pipeline?vista=versoes",
    "pipeline?vista=custos", "pipeline?vista=notificacoes", "pipeline?vista=novo",
    "chat", "chat?canal=sw_clara", "chat?canal=sw_imobiliario",
    "campanhas", "receita", "receita?vista=contas", "receita?vista=utilizacao", "receita?vista=trials",
    "reativacao", "reativacao?vista=regras", "reativacao?vista=modelos", "reativacao?vista=envios",
    "impacto", "impacto?vista=tarefas", "impacto?vista=leads", "impacto?vista=contas", "impacto?vista=pressupostos",
    "alertas", "alertas?estado=resolvidos", "alertas?estado=todos",
    "definicoes", "definicoes?vista=utilizadores", "definicoes?vista=chaves", "definicoes?vista=ligacoes",
]

BANNER = (
    '<div style="background:#fff4e0;border-bottom:1px solid #e9c98f;color:#5a3a00;padding:8px 16px;font:13px/1.4 system-ui,sans-serif">'
    "Demonstração estática com dados de exemplo. Os dashboards e a navegação funcionam; filtros, formulários e botões só funcionam na app instalada."
    "</div>"
)


def static_path(url_path: str, query: str) -> str:
    """/n5-controlo/demo/pipeline?vista=backlog -> pipeline/vista-backlog/"""
    rel = url_path[len(BASE):].strip("/")
    q = parse_qs(query)
    for key in ("vista", "estado", "canal"):
        if key in q:
            rel = f"{rel}/{key}-{q[key][0]}".strip("/")
            break
    return rel


def rewrite(html: str) -> str:
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S)
    html = re.sub(r'<link[^>]+as="script"[^>]*/?>', "", html)

    def fix(m: re.Match) -> str:
        href = m.group(1).replace("&amp;", "&")
        u = urlparse(href)
        if not u.path.startswith(BASE):
            return m.group(0)
        if "/_next/" in u.path:
            return m.group(0)
        rel = static_path(u.path, u.query)
        return f'href="{BASE}/{rel + "/" if rel else ""}"'

    html = re.sub(r'href="(/n5-controlo/demo[^"]*)"', fix, html)
    html = re.sub(r"<form\b", '<form onsubmit="return false"', html)
    html = re.sub(r"(<body[^>]*>)", r"\1" + BANNER, html, count=1)
    return html


def main() -> None:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(f"{ORIGIN}{BASE}/login")
        page.fill("#email", "socio@exemplo.n5")
        page.fill("#password", os.environ["DEMO_PASSWORD"])  # a mesma do seed; nunca no repositório
        page.click("button:has-text('Entrar')")
        page.wait_for_url(re.compile(r".*/demo/?$"))

        queue = list(PAGES)
        seen: set[str] = set()
        while queue:
            item = queue.pop(0)
            if item in seen:
                continue
            seen.add(item)
            path, _, query = item.partition("?")
            res = page.goto(f"{ORIGIN}{BASE}/{item}")
            if not res or res.status != 200:
                print("ignorado", item, res.status if res else "?")
                continue
            html = page.content()
            # Fichas de feedback e itens do roadmap a partir das listas
            for detail in re.findall(r'href="/n5-controlo/demo/((?:comunidades|pipeline)/[A-Za-z0-9_]+)"', html):
                if detail not in seen:
                    queue.append(detail)
            rel = static_path(f"{BASE}/{path}", query)
            target = os.path.join(OUT, rel, "index.html")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "w", encoding="utf-8") as fh:
                fh.write("<!DOCTYPE html>" + rewrite(html))
            print("exportado", rel or "(painel geral)")
        browser.close()

    shutil.copytree(os.path.join(os.path.dirname(__file__), "..", ".next", "static"), os.path.join(OUT, "_next", "static"))
    print("Pronto:", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
