import { BottomBar } from "./bottomBar"
import { Canvas } from "./canvas"
import { LeftSidebarBar } from "./leftSidebar"
import { RightSideBar } from "./rightSidebar"
import "./styles.css"
import { TopHeader } from "./topHeader"
export const Editor=()=>{
    return(
        <div>
            <TopHeader/>
            <toolbar/>
            <div>
                <LeftSidebarBar/>
                <Canvas/>
                <RightSideBar/>

            </div>
            <BottomBar/>


        </div>
    )
}