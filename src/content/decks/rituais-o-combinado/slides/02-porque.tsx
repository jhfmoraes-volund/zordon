import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlidePorque() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            POR QUE EXISTEM <span>/</span> DE FORA PRA DENTRO
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.forgeStage}`}>
        <div>
          <Eyebrow>
            <span className="pri">A FUNÇÃO DO RITUAL</span> · traduzir contexto
            em verdade interna
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            O ritual traduz o mundo de fora
            <br />
            na <em>nossa realidade interna</em>.
          </h2>
        </div>

        {/* Fontes externas → Ritual → Realidade interna */}
        <div className={styles.forgePipe}>
          <div className="pipe-step">
            <div className="step-head">
              <span className="label">Fontes (SSOT)</span>
              <span className="num">01</span>
            </div>
            <h4>Onde o contexto nasce</h4>
            <p>
              A fonte da verdade pode morar fora do Zordon. Tudo bem — só
              precisa estar linkada ao ritual.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">A</span>
                <span className="pri-dot" />
                Reuniões (Granola / transcrições)
              </div>
              <div className="item">
                <span className="ix">B</span>
                <span className="pri-dot" />
                Notion, planilhas, Google Drive
              </div>
              <div className="item">
                <span className="ix">C</span>
                <span className="pri-dot" />
                Decisões e notas do cliente
              </div>
            </div>
          </div>

          <div className="pipe-arrow">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">entra</span>
            <div className="line" />
          </div>

          <div className="pipe-step">
            <div className="step-head">
              <span className="label">O ritual</span>
              <span className="num">02</span>
            </div>
            <h4>O tradutor</h4>
            <p>
              O ritual recebe o contexto bruto, a Vitoria estrutura, e o PM
              decide. É o ponto onde o externo vira interno.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">R1</span>
                <span className="pri-dot" />
                Sprint Planning
              </div>
              <div className="item">
                <span className="ix">R2</span>
                <span className="pri-dot" />
                PM Review
              </div>
              <div className="item">
                <span className="ix">R3</span>
                <span className="pri-dot" />
                Release Planning
              </div>
            </div>
          </div>

          <div className="pipe-arrow handoff">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">vira verdade</span>
            <div className="line" />
          </div>

          <div className="pipe-step forge">
            <div className="step-head">
              <span className="label">Realidade interna</span>
              <span className="num">03</span>
            </div>
            <h4>O que o time enxerga</h4>
            <p>
              Sem o ritual, nada disso existe pra dentro: o board fica
              desatualizado e a liderança decide no escuro.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">I1</span>
                <span className="pri-dot" />
                Board e tasks <span className="role">Execução</span>
              </div>
              <div className="item">
                <span className="ix">I2</span>
                <span className="pri-dot" />
                Decisões rastreáveis <span className="role">Histórico</span>
              </div>
              <div className="item">
                <span className="ix">I3</span>
                <span className="pri-dot" />
                Vitoria com contexto <span className="role">Agente</span>
              </div>
              <div className="item">
                <span className="ix">I4</span>
                <span className="pri-dot" />
                Liderança enxerga <span className="role">Decisão</span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.forgeResult}>
          <div className="result-main">
            <div className="label">A consequência</div>
            <h5>
              Sem ritual preenchido, o de fora <em>nunca</em> vira verdade de
              dentro.
            </h5>
          </div>
          <div className="stat-cell">
            <div className="label">Entrada</div>
            <div className="v">Contexto</div>
            <div className="u">externo, linkado</div>
          </div>
          <div className="stat-cell">
            <div className="label">Tradutor</div>
            <div className="v brand">O ritual</div>
            <div className="u">+ Vitoria + decisão do PM</div>
          </div>
          <div className="stat-cell">
            <div className="label">Saída</div>
            <div className="v">Realidade</div>
            <div className="u">interna e confiável</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · POR QUE EXISTEM" num="02 / 10" />
    </>
  );
}
