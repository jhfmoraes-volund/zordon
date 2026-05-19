import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide02Overview() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            VISÃO GERAL <span>/</span> 03 FASES
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage}>
        <Eyebrow>
          <span className="pri">CICLO COMPLETO</span> · do comercial ao
          pós-go-live
        </Eyebrow>
        <h2 className={styles.titleH2} style={{ maxWidth: 1400 }}>
          A operação é dividida em <em>três fases</em>
          <br />
          com cadência e responsabilidades próprias.
        </h2>

        <div className={styles.ovRail}>
          <div className="ov-phase">
            <div className="marker">1</div>
            <div className="ph-eyebrow">FASE 01</div>
            <h3>Imersão</h3>
            <div className="duration">· 4 dias úteis</div>
            <p className="desc">
              Do primeiro contato comercial ao alinhamento final. Entendimento
              da jornada, mapeamento de risco, definição de escopo e
              cronograma.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Comercial
              </div>
              <div className="step">
                <span className="ix">02</span>Proposta
              </div>
              <div className="step">
                <span className="ix">03</span>KickOff
              </div>
              <div className="step">
                <span className="ix">04</span>Design Session
              </div>
              <div className="step">
                <span className="ix">05</span>Refino interno
              </div>
              <div className="step">
                <span className="ix">06</span>Alinhamento final
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">2</div>
            <div className="ph-eyebrow">FASE 02</div>
            <h3>Ops</h3>
            <div className="duration">· 1 a 3 meses</div>
            <p className="desc">
              Execução em sprints (Scrum Volund), governança contínua com o
              cliente, QA interno e externo, auditoria técnica + segurança e
              go-live em produção.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Sprints
              </div>
              <div className="step">
                <span className="ix">02</span>Alinhamento contínuo
              </div>
              <div className="step">
                <span className="ix">03</span>QA
              </div>
              <div className="step">
                <span className="ix">04</span>Auditoria + Segurança
              </div>
              <div className="step">
                <span className="ix">05</span>Go Live
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">3</div>
            <div className="ph-eyebrow">FASE 03</div>
            <h3>Pós-Ops</h3>
            <div className="duration">· 3 meses</div>
            <p className="desc">
              Operação assistida sobre o ambiente produtivo, janela de
              contigência para ajustes finais e avaliação de satisfação do
              cliente (NPS, CSAT).
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Operação assistida
              </div>
              <div className="step">
                <span className="ix">02</span>Contigência
              </div>
              <div className="step">
                <span className="ix">03</span>Avaliação de satisfação
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO" num="02 / 10" />
    </>
  );
}
