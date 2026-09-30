export const RightSideBar = () => {
    return (
        <aside className="right-sidebar">

            <div className="right-tabs">

                <button className="right-tab active">
                    Diagram
                </button>

                <button className="right-tab">
                    Style
                </button>

            </div>

            <div className="properties">

                <section className="property-section">
                    <div className="property-title">
                        <span>⌄</span>
                        View
                    </div>

                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            defaultChecked
                        />
                        <span>Grid</span>
                    </label>

                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            defaultChecked
                        />
                        <span>Page View</span>
                    </label>
                    <div className="background-row">

                        <label className="checkbox-row">
                            <input type="checkbox" />
                            <span>Background</span>
                        </label>

                        <button>
                            Change...
                        </button>

                    </div>
                    <div className="grid-settings">

                        <div className="grid-size">
                            10 pt
                            <span>⌃⌄</span>
                        </div>

                        <div className="grid-color" />

                    </div>

                </section>

                <section className="property-section">

                    <div className="property-title">
                        <span>⌄</span>
                        Options
                    </div>
                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            defaultChecked
                        />
                        <span>Connection Arrows</span>
                    </label>

                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            defaultChecked
                        />
                        <span>Connection Points</span>
                    </label>
                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            defaultChecked
                        />
                        <span>Guides</span>
                    </label>

                </section>

                <section className="property-section collapsed">

                    <div className="property-title">
                        <span>›</span>
                        Paper Size
                    </div>

                </section>
                <div className="property-actions">

                    <button>
                        Edit Data...
                    </button>

                    <button>
                        Clear Default Style
                    </button>

                </div>

            </div>

        </aside>
    )
}