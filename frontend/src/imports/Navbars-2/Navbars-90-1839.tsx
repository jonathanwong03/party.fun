import svgPaths from "./svg-bl06590ed3";

function Button() {
  return (
    <div className="bg-[rgba(255,77,46,0.12)] h-[29.964px] relative rounded-[17455630px] shrink-0 w-[86.148px]" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[18.728px] left-[44.95px] text-[13.109px] text-center text-white top-[5.62px] w-[82.402px]">All Events</p>
      </div>
    </div>
  );
}

function Button1() {
  return (
    <div className="h-[29.961px] relative rounded-[17455630px] shrink-0 w-[87.974px]" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[18.728px] left-[49.44px] text-[13.109px] text-center text-white top-[5.62px] whitespace-nowrap">My Events</p>
      </div>
    </div>
  );
}

function Navigation() {
  return (
    <div className="absolute content-stretch flex gap-[3.739px] h-[29.964px] items-center left-[537.49px] top-[16.85px] w-[181.66px]" data-name="Navigation">
      <Button />
      <Button1 />
    </div>
  );
}

function Icon() {
  return (
    <div className="absolute left-[1056.25px] size-[14.981px] top-[21.54px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.9807 14.9807">
        <g id="Icon">
          <path d={svgPaths.p2afc6280} id="Vector" stroke="var(--stroke-0, #F5F5F7)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.24839" />
          <path d={svgPaths.p15747900} id="Vector_2" stroke="var(--stroke-0, #F5F5F7)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.24839" />
        </g>
      </svg>
    </div>
  );
}

function Group() {
  return (
    <div className="absolute contents inset-[37.5%_4.72%_37.88%_94.07%]">
      <div className="absolute inset-[37.5%_5.53%_37.88%_94.07%]" data-name="Vector">
        <div className="absolute inset-[-4.23%_-12.43%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 6.26814 15.9981">
            <path d={svgPaths.p10fe900} id="Vector" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.24839" />
          </svg>
        </div>
      </div>
      <div className="absolute inset-[42.97%_4.72%_43.36%_94.94%]" data-name="Vector">
        <div className="absolute inset-[-7.62%_-14.92%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 5.43151 9.44269">
            <path d={svgPaths.pc342a80} id="Vector" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.24839" />
          </svg>
        </div>
      </div>
      <div className="absolute inset-[49.81%_4.72%_50.19%_94.47%]" data-name="Vector">
        <div className="absolute inset-[-0.62px_-6.22%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 11.2879 1.24839">
            <path d="M10.6637 0.624194H0.624194" id="Vector" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.24839" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Group2() {
  return (
    <div className="absolute contents left-[1005.68px] top-[15.92px]">
      <Icon />
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[18.728px] left-[1027.68px] text-[#f5f5f7] text-[13.109px] text-center top-[21.54px] whitespace-nowrap">{` Profile`}</p>
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[18.728px] left-[1109.21px] text-[13.109px] text-center text-white top-[20.6px] whitespace-nowrap">Logout</p>
      <Group />
      <div className="absolute left-[1191.09px] size-[28.092px] top-[15.92px]">
        <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 28.0917 28.0917">
          <circle cx="14.0459" cy="14.0459" fill="var(--fill-0, #FF4D2E)" id="Ellipse 1" r="14.0459" />
        </svg>
      </div>
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium h-[19.664px] leading-[18.728px] left-[1205.13px] text-[18.728px] text-center text-white top-[21.54px] w-[9.364px]">J</p>
    </div>
  );
}

function Text() {
  return (
    <div className="absolute h-[21.63px] left-[8.5px] top-[2.29px] w-[9.201px]" data-name="Text">
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[21.631px] left-[5.01px] text-[14.42px] text-black text-center top-[-1.4px] whitespace-nowrap">p</p>
    </div>
  );
}

function Container1() {
  return (
    <div className="col-1 h-[28.092px] ml-0 mt-[0.94px] relative rounded-[9.364px] row-1 w-[28.489px]" style={{ backgroundImage: "linear-gradient(135.402deg, rgb(255, 77, 46) 0%, rgb(255, 203, 60) 100%)" }} data-name="Container">
      <Text />
    </div>
  );
}

function Text1() {
  return (
    <div className="col-1 h-[25.283px] ml-[36.52px] mt-0 overflow-clip relative row-1 w-[74.911px]" data-name="Text">
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[0] left-[37.5px] text-[#f5f5f7] text-[16.855px] text-center top-0 tracking-[-0.3371px] whitespace-nowrap">
        <span className="leading-[25.283px]">party</span>
        <span className="leading-[25.283px] text-[#ff4d2e]">.fun</span>
      </p>
    </div>
  );
}

function Group1() {
  return (
    <div className="grid-cols-[max-content] grid-rows-[max-content] inline-grid leading-[0] place-items-start relative shrink-0">
      <Container1 />
      <Text1 />
    </div>
  );
}

function Button2() {
  return (
    <div className="absolute content-stretch flex h-[39.328px] items-center left-[43.53px] top-[7.66px] w-[119.858px]" data-name="Button">
      <Group1 />
    </div>
  );
}

function Group3() {
  return (
    <div className="absolute contents left-[7px] top-[21.48px]">
      <div className="absolute h-0 left-[7px] top-[21.48px] w-[22.705px]">
        <div className="absolute inset-[-0.99px_0_0_0]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 22.705 0.987174">
            <line id="Line 1" stroke="var(--stroke-0, white)" strokeWidth="0.987174" x2="22.705" y1="0.493587" y2="0.493587" />
          </svg>
        </div>
      </div>
      <div className="absolute h-0 left-[7px] top-[27.4px] w-[22.705px]">
        <div className="absolute inset-[-0.99px_0_0_0]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 22.705 0.987174">
            <line id="Line 1" stroke="var(--stroke-0, white)" strokeWidth="0.987174" x2="22.705" y1="0.493587" y2="0.493587" />
          </svg>
        </div>
      </div>
      <div className="absolute h-0 left-[7px] top-[32.83px] w-[22.705px]">
        <div className="absolute inset-[-0.49px_0]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 22.705 0.987174">
            <path d="M0 0.493587H22.705" id="Line 3" stroke="var(--stroke-0, white)" strokeWidth="0.987174" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Group4() {
  return (
    <div className="absolute contents left-[7px] top-[7.66px]">
      <Button2 />
      <Group3 />
    </div>
  );
}

function Container() {
  return (
    <div className="absolute bg-black h-[59.929px] left-0 right-[-0.07px] top-[1.34px]" data-name="Container">
      <Navigation />
      <Group2 />
      <Group4 />
    </div>
  );
}

export default function Navbars() {
  return (
    <div className="bg-[rgba(0,0,0,0.75)] border-[rgba(255,255,255,0.08)] border-b-[0.527px] border-solid relative size-full" data-name="Navbars">
      <Container />
    </div>
  );
}