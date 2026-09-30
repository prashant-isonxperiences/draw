import { ShapeLibrary } from "./ShapeLibrary"

export const LeftSidebarBar = () => {
    return (
        <aside className="left-sidebar">

            <div className="shape-search">

                <input
                    type="text"
                    placeholder="Type / to search"
                />

                <span>⌕</span>

            </div>

            <div className="sidebar-scroll">

                <ShapeLibrary />

            </div>

            <button className="more-shapes">
                + More Shapes
            </button>
        </aside>
    )
}