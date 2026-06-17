import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideRituais() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            VISÃO GERAL <span>/</span> 03 RITUAIS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage}>
        <Eyebrow>
          <span className="pri">OS TRÊS RITUAIS</span> · cadência · dono ·
          output
        </Eyebrow>
        <h2 className={styles.titleH2} style={{ maxWidth: 1400 }}>
          Três rituais, cada um com <em>cadência</em>
          <br />e dono próprios.
        </h2>

        <div className={styles.ovRail}>
          <div className="ov-phase">
            <div className="marker">1</div>
            <div className="ph-eyebrow">RITUAL 01 · PM / LEAD</div>
            <h3>Sprint Planning</h3>
            <div className="duration">· semanal · 1 por sprint</div>
            <p className="desc">
              O plano da sprint que começa. Lê o contexto da semana, a Vitoria
              propõe o plano de tasks e o PM aprova.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Lê contexto
              </div>
              <div className="step">
                <span className="ix">02</span>Vitoria propõe
              </div>
              <div className="step">
                <span className="ix">03</span>PM aprova
              </div>
              <div className="step">
                <span className="ix">04</span>Plano publicado
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">2</div>
            <div className="ph-eyebrow">RITUAL 02 · LEAD / ADMIN</div>
            <h3>PM Review</h3>
            <div className="duration">· semanal · sempre consultável</div>
            <p className="desc">
              O pulso do projeto. A Vitoria gera um report estruturado da semana
              que a liderança consulta a qualquer momento.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Liga reuniões + notas
              </div>
              <div className="step">
                <span className="ix">02</span>Vitoria redige report
              </div>
              <div className="step">
                <span className="ix">03</span>Lead revisa
              </div>
              <div className="step">
                <span className="ix">04</span>Publicado pra semana
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">3</div>
            <div className="ph-eyebrow">RITUAL 03 · MANAGER / LEAD</div>
            <h3>Release Planning</h3>
            <div className="duration">· 1× / projeto · re-rodável</div>
            <p className="desc">
              A ordem do roadmap. Decide a sequência dos PRDs e quebra em
              sprints. Roda na imersão e quando o escopo muda de verdade.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>PRDs priorizados
              </div>
              <div className="step">
                <span className="ix">02</span>Quebra em stories
              </div>
              <div className="step">
                <span className="ix">03</span>Revisão
              </div>
              <div className="step">
                <span className="ix">04</span>Roadmap aprovado
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · VISÃO GERAL" num="04 / 10" />
    </>
  );
}
