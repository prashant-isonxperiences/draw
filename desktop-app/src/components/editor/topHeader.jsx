export const TopHeader = () => {
    return (
        <header className="top-header">

            <div className="header-left">

                <div className="app-logo">
                    <div className="logo-node logo-node-top" />
                    <div className="logo-node logo-node-left" />
                    <div className="logo-node logo-node-right" />
                    <div className="logo-line logo-line-left" />
                    <div className="logo-line logo-line-right" />
                </div>

                <div className="document-title">
                    Untitled Diagram
                </div>
            </div>

            <div className="header-menu">

                <button>File</button>
                <button>Edit</button>
                <button>View</button>
                <button>Arrange</button>
                <button>Extras</button>
                <button>Help</button>

            </div>

            <button className="share-button">
                <span>♧</span>
                Share
            </button>

        </header>
    )
}