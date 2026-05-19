import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide08Forge() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 02 · OPS <span>/</span> FORGE · ESTEIRA AGÊNTICA
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.forgeStage}`}>
        <div>
          <Eyebrow>
            <span className="pri">FORGE</span> · esteira agêntica · do briefing
            ao piloto
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            A FORGE transforma <em>conversas em piloto</em>,
            <br />
            em horas — não em semanas.
          </h2>
        </div>

        {/* Pipeline: Insumos → Motor → Forge */}
        <div className={styles.forgePipe}>
          {/* 01 · INSUMOS */}
          <div className="pipe-step">
            <div className="step-head">
              <span className="label">Insumos</span>
              <span className="num">01</span>
            </div>
            <h4>Coleta com suporte agêntico</h4>
            <p>
              Transcrições de vídeo, reuniões e a própria Design Session
              alimentam a esteira. O agente acompanha em tempo real e organiza
              o material bruto.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">A</span>
                <span className="pri-dot" />
                Transcrições de vídeo e calls
              </div>
              <div className="item">
                <span className="ix">B</span>
                <span className="pri-dot" />
                Design Session com copiloto
              </div>
              <div className="item">
                <span className="ix">C</span>
                <span className="pri-dot" />
                Documentos e referências do cliente
              </div>
            </div>
          </div>

          {/* Arrow 1 */}
          <div className="pipe-arrow">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">extrai</span>
            <div className="line" />
          </div>

          {/* 02 · MOTOR */}
          <div className="pipe-step">
            <div className="step-head">
              <span className="label">Motor</span>
              <span className="num">02</span>
            </div>
            <h4>Levantamento estruturado</h4>
            <p>
              Os insumos entram em um motor que destila requisitos, regras de
              negócio e PRDs — prontos para revisão humana antes do handoff.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">R1</span>
                <span className="pri-dot" />
                Requisitos funcionais
              </div>
              <div className="item">
                <span className="ix">R2</span>
                <span className="pri-dot" />
                Regras de negócio
              </div>
              <div className="item">
                <span className="ix">PR</span>
                <span className="pri-dot" />
                PRDs e tasks priorizadas
              </div>
            </div>
          </div>

          {/* Arrow 2 · HANDOFF */}
          <div className="pipe-arrow handoff">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">Vitor · handoff</span>
            <div className="line" />
          </div>

          {/* 03 · FORGE */}
          <div className="pipe-step forge">
            <div className="step-head">
              <span className="label">FORGE</span>
              <span className="num">03</span>
            </div>
            <h4>Fábrica de pilotos</h4>
            <p>
              Com tasks e PRDs estruturados, a FORGE orquestra agentes,
              sub-agentes e skills para gerar um piloto funcional em poucas
              horas.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">A1</span>
                <span className="pri-dot" />
                Agentes <span className="role">Executores</span>
              </div>
              <div className="item">
                <span className="ix">A2</span>
                <span className="pri-dot" />
                Harness <span className="role">Ambiente</span>
              </div>
              <div className="item">
                <span className="ix">A3</span>
                <span className="pri-dot" />
                Sub-agentes <span className="role">Especialistas</span>
              </div>
              <div className="item">
                <span className="ix">A4</span>
                <span className="pri-dot" />
                Orquestração <span className="role">Contexto</span>
              </div>
              <div className="item">
                <span className="ix">A5</span>
                <span className="pri-dot" />
                Skills &amp; Habilidades <span className="role">Toolset</span>
              </div>
            </div>
          </div>
        </div>

        {/* Resultado consolidado */}
        <div className={styles.forgeResult}>
          <div className="result-main">
            <div className="label">Resultado</div>
            <h5>
              Piloto funcional pronto para a primeira <em>Sprint</em> da Ops.
            </h5>
          </div>
          <div className="stat-cell">
            <div className="label">Tempo até piloto</div>
            <div className="v brand">~ horas</div>
            <div className="u">vs. semanas no caminho tradicional</div>
          </div>
          <div className="stat-cell">
            <div className="label">Input</div>
            <div className="v">PRDs + Tasks</div>
            <div className="u">estruturados pelo motor</div>
          </div>
          <div className="stat-cell">
            <div className="label">Output</div>
            <div className="v">Piloto + base</div>
            <div className="u">de código pronta para Sprint 01</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 02 · FORGE" num="08 / 10" />
    </>
  );
}
