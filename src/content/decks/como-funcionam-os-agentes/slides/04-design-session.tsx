import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideDesignSession() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            APP 01 <span>/</span> DESIGN SESSION · VITOR
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage}>
        <Eyebrow>
          <span className="pri">DESIGN SESSION</span> · onde o porquê nasce ·
          agente: Vitor
        </Eyebrow>
        <h2 className={styles.titleH2} style={{ maxWidth: 1500 }}>
          Vitor transforma conversa de descoberta
          <br />
          em <em>artefato estruturado</em>.
        </h2>

        <div className={styles.forgePipe}>
          <div className="pipe-step">
            <div className="step-head">
              <span className="label">Insumos</span>
              <span className="num">01</span>
            </div>
            <h4>O que entra na sessão</h4>
            <p>
              Conversa com o cliente, contexto do negócio e anexos. Vitor lê
              tudo que está ligado à sessão.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">A</span>
                <span className="pri-dot" />
                Contexto de negócio
              </div>
              <div className="item">
                <span className="ix">B</span>
                <span className="pri-dot" />
                Anexos e fontes (ContextSource)
              </div>
              <div className="item">
                <span className="ix">C</span>
                <span className="pri-dot" />
                Código do projeto <span className="role">workspace</span>
              </div>
            </div>
          </div>

          <div className="pipe-arrow">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">Vitor estrutura</span>
            <div className="line" />
          </div>

          <div className="pipe-step">
            <div className="step-head">
              <span className="label">O que Vitor faz</span>
              <span className="num">02</span>
            </div>
            <h4>Entidades da descoberta</h4>
            <p>
              Lê e escreve as peças da DS, registra decisões e resolve perguntas
              em aberto — sempre com referência à fonte.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">T</span>
                <span className="pri-dot" />
                Visão · personas · brainstorm · riscos · tech specs
              </div>
              <div className="item">
                <span className="ix">T</span>
                <span className="pri-dot" />
                Decisões + perguntas em aberto
              </div>
              <div className="item">
                <span className="ix">T</span>
                <span className="pri-dot" />
                Memória da sessão e do projeto
              </div>
            </div>
          </div>

          <div className="pipe-arrow handoff">
            <div className="line" />
            <span className="glyph">▶</span>
            <span className="tag">vira spec</span>
            <div className="line" />
          </div>

          <div className="pipe-step forge">
            <div className="step-head">
              <span className="label">Saída</span>
              <span className="num">03</span>
            </div>
            <h4>O que sai pronto</h4>
            <p>
              O destino da DS: PRDs propostos, prontos pra priorização e, depois,
              pra construção.
            </p>
            <div className="items">
              <div className="item">
                <span className="ix">I1</span>
                <span className="pri-dot" />
                PRDs propostos <span className="role">Forge-able</span>
              </div>
              <div className="item">
                <span className="ix">I2</span>
                <span className="pri-dot" />
                Decisões rastreáveis <span className="role">Histórico</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · DESIGN SESSION" num="04 / 11" />
    </>
  );
}
