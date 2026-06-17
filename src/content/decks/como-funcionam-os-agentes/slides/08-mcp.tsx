import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideMcp() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            AS FERRAMENTAS <span>/</span> MCP EM 1 TELA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage}>
        <Eyebrow>
          <span className="pri">COMO A TOOL RODA</span> · daemon lê · app executa
        </Eyebrow>
        <h2 className={styles.titleH2} style={{ maxWidth: 1500 }}>
          O daemon só conhece a <em>forma</em> da tool.
          <br />
          Quem executa é o app.
        </h2>

        <div className={styles.forgePipe}>
          <div className="pipe-step">
            <div className="step-head">
              <span className="label">Daemon</span>
              <span className="num">01</span>
            </div>
            <h4>Conhece o catálogo</h4>
            <p>
              O agente vê a lista de ferramentas e seus campos (via MCP). Mas o
              daemon não tem a lógica — ele não toca o banco.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">A</span>
                <span className="pri-dot" />
                Só o schema de cada tool
              </div>
              <div className="item">
                <span className="ix">B</span>
                <span className="pri-dot" />
                Filtrado por agente + superfície
              </div>
            </div>
          </div>

          <div className="pipe-arrow">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">chama por HTTP</span>
            <div className="line" />
          </div>

          <div className="pipe-step">
            <div className="step-head">
              <span className="label">Tool router</span>
              <span className="num">02</span>
            </div>
            <h4>O app executa</h4>
            <p>
              A chamada chega no Zordon, que resolve o contexto (projeto,
              membro, sprint) e roda a lógica real contra o banco.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">C</span>
                <span className="pri-dot" />
                Contexto resolvido no servidor
              </div>
              <div className="item">
                <span className="ix">D</span>
                <span className="pri-dot" />
                Lógica + banco reais <span className="role">app</span>
              </div>
            </div>
          </div>

          <div className="pipe-arrow handoff">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">resultado</span>
            <div className="line" />
          </div>

          <div className="pipe-step forge">
            <div className="step-head">
              <span className="label">Registry único</span>
              <span className="num">03</span>
            </div>
            <h4>Uma fonte de verdade</h4>
            <p>
              As ferramentas vivem num catálogo único. Tool nova = registrar uma
              vez — sem duplicar lógica em dois lugares.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">I1</span>
                <span className="pri-dot" />
                Lógica mora só no app
              </div>
              <div className="item">
                <span className="ix">I2</span>
                <span className="pri-dot" />
                Validação extra antes de executar
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · MCP" num="08 / 11" />
    </>
  );
}
