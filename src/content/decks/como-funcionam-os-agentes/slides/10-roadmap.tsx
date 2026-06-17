import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideRoadmap() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            PRA ONDE VAI <span>/</span> ROADMAP
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage}>
        <Eyebrow>
          <span className="pri">O QUE VEM</span> · escrita · v2 · cobertura
        </Eyebrow>
        <h2 className={styles.titleH2} style={{ maxWidth: 1400 }}>
          Os agentes vão de <em>ler</em>
          <br />
          para <em>agir com segurança</em>.
        </h2>

        <div className={styles.ovRail}>
          <div className="ov-phase">
            <div className="marker">1</div>
            <div className="ph-eyebrow">ALPHA · FASE 3</div>
            <h3>Escrita no Ops</h3>
            <div className="duration">· atrás de toggle</div>
            <p className="desc">
              Alpha cria e edita task, sprint e alocação direto pelo chat —
              ligado por um interruptor de segurança por projeto.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Criar / editar task
              </div>
              <div className="step">
                <span className="ix">02</span>Sprint + alocação
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">2</div>
            <div className="ph-eyebrow">DAEMON · V2</div>
            <h3>Cada um roda o seu</h3>
            <div className="duration">· login próprio</div>
            <p className="desc">
              Daemon com identidade por usuário — destrava integrações
              (GitHub, Calendar) e isola o contexto de cada PM.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Auth por usuário
              </div>
              <div className="step">
                <span className="ix">02</span>Integrações (Composio)
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">3</div>
            <div className="ph-eyebrow">COBERTURA</div>
            <h3>Mais superfícies</h3>
            <div className="duration">· evolução contínua</div>
            <p className="desc">
              Toolset dedicado pro Release Planning e checagem automática de
              paridade das ferramentas entre os dois lados.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Release Planning
              </div>
              <div className="step">
                <span className="ix">02</span>Paridade de tools
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · ROADMAP" num="10 / 11" />
    </>
  );
}
