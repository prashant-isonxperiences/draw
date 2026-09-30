const tools = [
  "▣",
  "100%",
  "⌕",
  "⌕",
  "↶",
  "↷",
  "▣",
  "▧",
  "▱",
  "✎",
  "▣",
  "→",
  "⌁",
  "+",
  "◯",
  "▦",
  "〽",
  "✣",
  "⌘",
];
export const TollBar=()=>{
    return(
         <div className="toolbar">

      <div className="toolbar-group">

        {tools.map((tool, index) => {

          if (tool === "100%") {
            return (
              <button
                key={index}
                className="zoom-button"
              >
                100%
                <span>⌄</span>
              </button>
            );
          }
           return (
            <button
              key={index}
              className="toolbar-button"
            >
              {tool}
            </button>
          );
        })}

      </div>

      <div className="toolbar-right">

        <button className="fullscreen-button">
          ⛶
        </button>
          <button>
          ◧
        </button>

        <button>
          ⌄
        </button>

      </div>

    </div>
    )
}