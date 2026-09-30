const shapes = [
    "rectangle",
    "rounded",
    "text",
    "heading",
    "ellipse",

    "square",
    "circle",
    "database",
    "diamond",
    "parallelogram",

    "hexagon",
    "triangle",
    "cylinder",
    "cloud",
    "document",

    "table",
    "cube",
    "chevron",
    "trapezoid",
    "wave",

    "page",
    "note",
    "callout",
    "person",
    "actor",

    "arc",
    "halfCircle",
    "leftArrow",
    "rightArrow",
    "container",

    "rectangle2",
    "document2",
    "speech",
    "comment",
    "stick",

    "line",
    "dashed",
    "dotted",
    "arrow",
    "doubleArrow",

    "upArrow",
    "horizontalLine",
    "rightArrowLine",
    "leftArrowLine",
];
function ShapeIcon({ type }) {
    return (
        <div className={`shape-icon shape-${type}`}>
            {type === "text" && "Text"}
            {type === "heading" && "Heading"}
            {type === "person" && "♙"}
        </div>
    );
}
export const ShapeLibrary = () => {
    return (
        <div className="shape-library">

            <div className="library-section">

                <div className="section-header">
                    <span>⌄</span>
                    Scratchpad

                    <div className="section-actions">
                        <span>?</span>
                        <span>+</span>
                        <span>✎</span>
                        <span>×</span>
                    </div>
                </div>

                <div className="scratchpad">
                    Drag elements here
                </div>

            </div>
            <div className="library-section">

                <div className="section-header">
                    <span>⌄</span>
                    General
                </div>

                <div className="shape-grid">

                    {shapes.map((shape) => (
                        <div
                            key={shape}
                            className="shape-library-item"
                            draggable
                        >
                            <ShapeIcon type={shape} />
                        </div>
                    ))}

                </div>

            </div>

            <div className="library-section misc-section">

                <div className="section-header">
                    <span>›</span>
                    Misc
                </div>

            </div>

        </div>

    )
}